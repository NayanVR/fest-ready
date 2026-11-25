import { expect, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { paymentRoutes } from './payments.ts';

type Attempt = { provider: string; paymentId: string; amount: number };
const secret = 'fixture-admin';

async function withShop(run: (shop: {
  call: (path: string, init?: RequestInit) => Promise<Response>;
  attempts: Attempt[];
  notifications: { path: string; body: object }[];
  outages: object[];
}) => Promise<void>, options: {
  primaryEnabled?: boolean;
  attempt?: (attempt: Attempt, count: number) => Response | Promise<Response>;
  adminSecret?: string;
} = {}) {
  const attempts: Attempt[] = [];
  const notifications: { path: string; body: object }[] = [];
  const outages: object[] = [];
  const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/status') return Response.json({ providers: [{ id: 'alpha', available: true }] });
    if (pathname === '/routing') return Response.json({ primaryEnabled: options.primaryEnabled ?? false });
    if (pathname === '/admin/outage') {
      if (request.headers.get('X-Admin-Secret') !== secret) return new Response(null, { status: 401 });
      outages.push(await request.json());
      return new Response(null, { status: 204 });
    }
    const match = /^\/providers\/(\w+)\/payments$/.exec(pathname);
    if (!match) return new Response(null, { status: 404 });
    const { paymentId, amount } = await request.json();
    const attempt = { provider: match[1]!, paymentId, amount };
    attempts.push(attempt);
    return options.attempt?.(attempt, attempts.length) ?? approved(attempt);
  } });
  const app = express();
  app.use('/api/payments', paymentRoutes(fixture.url.origin, options.adminSecret ?? secret, async (path, body) => {
    notifications.push({ path, body });
  }, (res, status, error, message, fields) => { res.status(status).json({ error, message, ...fields }); }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    await run({
      call: (path, init) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payments${path}`, init),
      attempts, notifications, outages,
    });
  } finally {
    server.closeAllConnections();
    server.close();
    await fixture.stop(true);
  }
}

const approved = ({ provider, paymentId }: Attempt) => Response.json({ provider, paymentId }, { status: 201 });
const unavailable = () => Response.json({ error: 'PROVIDER_UNAVAILABLE' }, { status: 503 });
const post = (body: object, key?: string) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...key && { 'X-Admin-Secret': key } },
  body: JSON.stringify(body),
});
const payment = (customerId = 'demo-customer') => post({ customerId, provider: 'alpha', amount: 1200 });

test('fallback tries the remaining alternative after an explicit refusal and keeps a stable first choice', async () => {
  await withShop(async ({ call, attempts, notifications }) => {
    const response = await call('', payment());
    expect(response.status).toBe(201);
    expect(attempts.map(({ provider }) => provider).sort()).toEqual(['beta', 'gamma']);
    const [first, second] = attempts as [Attempt, Attempt];
    expect(first.paymentId).toBe(second.paymentId);
    expect(await response.json()).toEqual({ paymentId: first.paymentId, preferredProvider: 'alpha', provider: second.provider, route: 'fallback' });
    expect(notifications).toEqual([{ path: '/internal/orders', body: expect.objectContaining({
      paymentCohort: 'alpha', paymentCustomer: 'demo-customer', paymentOutcome: 'success', paymentRoute: 'fallback',
      provider: second.provider, amount: 1200, synthetic: true,
    }) }]);

    expect((await call('', payment())).status).toBe(201);
    expect(attempts[2]?.provider).toBe(first.provider);
  }, { attempt: (attempt, count) => count === 1 ? unavailable() : approved(attempt) });
});

test('fallback stops after a timeout or a 503 without the explicit refusal code', async () => {
  await withShop(async ({ call, attempts, notifications }) => {
    for (const upstreamStatus of [503, 'unreachable']) {
      const response = await call('', payment());
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: 'PAYMENT_UNAVAILABLE', preferredProvider: 'alpha', route: 'fallback', upstreamStatus });
    }
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.provider).toBe(attempts[1]?.provider);
    expect(notifications).toHaveLength(2);
    for (const { path, body } of notifications) {
      expect(path).toBe('/internal/orders');
      expect(body).toMatchObject({ paymentRoute: 'fallback', paymentOutcome: 'error' });
    }
  }, { async attempt(attempt, count) {
    if (count === 1) return Response.json({ error: 'UNKNOWN_RESULT' }, { status: 503 });
    if (count === 2) await Bun.sleep(2200);
    return approved(attempt);
  } });
});

test('failed primary attempts alert once per burst, except probes, and a cleared outage resets the throttle', async () => {
  await withShop(async ({ call, attempts, notifications, outages }) => {
    expect(await (await call('/demo')).json()).toEqual({ providers: [{ id: 'alpha', available: true }] });
    expect((await call('', payment('pay-probe-beta'))).status).toBe(400);
    expect((await call('', payment('pay-probe-alpha'))).status).toBe(502);
    expect(notifications.map(({ path }) => path)).toEqual(['/internal/orders']);

    const failures = await Promise.all([call('', payment()), call('', payment())]);
    expect(failures.map(({ status }) => status)).toEqual([502, 502]);
    expect(attempts.map(({ provider }) => provider)).toEqual(['alpha', 'alpha', 'alpha']);
    const alerts = () => notifications.filter(({ path }) => path === '/webhooks/alertmanager');
    expect(alerts()).toEqual([{ path: '/webhooks/alertmanager', body: expect.objectContaining({
      status: 'firing', alerts: [expect.objectContaining({ labels: { alertname: 'PaymentAvailabilityLow' }, annotations: { simulated: 'true' } })],
    }) }]);
    expect(notifications[1]?.path).toBe('/webhooks/alertmanager');

    const clear = { provider: 'alpha', status: null };
    expect((await call('/demo/outage', post(clear, 'wrong'))).status).toBe(401);
    expect(outages).toEqual([]);
    expect((await call('/demo/outage', post(clear, secret))).status).toBe(200);
    expect(outages).toEqual([clear]);
    expect((await call('', payment())).status).toBe(502);
    expect(alerts()).toHaveLength(2);
  }, { primaryEnabled: true, attempt: unavailable });
});

test('outage changes fail closed without a configured admin secret', async () => {
  await withShop(async ({ call, outages }) => {
    const response = await call('/demo/outage', post({ provider: 'alpha', status: 503 }));
    expect(response.status).toBe(401);
    expect(outages).toEqual([]);
  }, { adminSecret: '' });
});
