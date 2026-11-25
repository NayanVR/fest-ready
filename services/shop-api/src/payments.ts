import { createHash, randomUUID } from 'node:crypto';
import express from 'express';

const providers = ['alpha', 'beta', 'gamma'] as const;
type Provider = (typeof providers)[number];
const isProvider = (id: unknown): id is Provider => providers.some(provider => provider === id);
const probePrefix = 'pay-probe-';
const alertThrottleMs = 5000;

function fallbackProviders(preferredProvider: Provider, customerId: string) {
  const alternatives = providers.filter(provider => provider !== preferredProvider);
  const offset = createHash('sha256').update(customerId).digest()[0]! % alternatives.length;
  return [...alternatives.slice(offset), ...alternatives.slice(0, offset)];
}

export function paymentRoutes(
  paymentDemoUrl: string,
  adminSecret: string | undefined,
  postController: (path: string, body: object) => Promise<void>,
  sendError: (res: express.Response, status: number, error: string, message: string, details?: object) => void,
) {
  const router = express.Router();
  const base = paymentDemoUrl.replace(/\/+$/, '');
  const alerts = new Map<Provider, { time: number; sent: Promise<void> }>();
  const fixture = (path: string, init?: RequestInit) => fetch(base + path, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(2000),
  });
  const post = (path: string, body: object, headers?: Record<string, string>) => fixture(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const demoUnavailable = (res: express.Response) => sendError(res, 502, 'PAYMENT_DEMO_UNAVAILABLE', 'The payment demo fixture is unavailable.');

  router.get('/demo', async (_req, res) => {
    try {
      const response = await fixture('/status');
      if (response.ok) return res.json(await response.json());
      await response.body?.cancel();
    } catch {
      // Respond with the same public error for transport and fixture failures.
    }
    return demoUnavailable(res);
  });

  router.post('/demo/outage', (req, res, next) => {
    if (!adminSecret?.trim() || req.get('X-Admin-Secret') !== adminSecret) {
      return sendError(res, 401, 'UNAUTHORIZED', 'A valid admin secret is required.');
    }
    next();
  }, express.json(), async (req, res) => {
    const { provider, status } = req.body ?? {};
    if (!isProvider(provider) || (status !== 503 && status !== null)) {
      return sendError(res, 400, 'BAD_REQUEST', 'Provide a demo provider and status 503 or null.');
    }
    try {
      const response = await post('/admin/outage', { provider, status }, { 'X-Admin-Secret': adminSecret! });
      await response.body?.cancel();
      if (response.ok) {
        if (status === null) alerts.delete(provider);
        return res.json({ ok: true, provider, status });
      }
    } catch {
      // The upstream response can contain internal diagnostics.
    }
    return demoUnavailable(res);
  });

  async function attempt(provider: Provider, paymentId: string, amount: number) {
    try {
      const response = await post(`/providers/${provider}/payments`, { paymentId, amount });
      if (response.status === 201 || response.status === 503) {
        const body = await response.json().catch(() => null);
        return {
          success: response.status === 201 && body?.provider === provider && body?.paymentId === paymentId,
          unavailable: response.status === 503 && body?.error === 'PROVIDER_UNAVAILABLE',
          upstreamStatus: response.status,
        };
      }
      await response.body?.cancel();
      return { success: false, unavailable: false, upstreamStatus: response.status };
    } catch {
      return { success: false, unavailable: false, upstreamStatus: 'unreachable' };
    }
  }

  function alert(preferredProvider: Provider) {
    const time = Date.now();
    const previous = alerts.get(preferredProvider);
    if (previous && time - previous.time < alertThrottleMs) return previous.sent;
    const labels = { alertname: 'PaymentAvailabilityLow' };
    const sent = postController('/webhooks/alertmanager', {
      version: '4', status: 'firing', groupLabels: labels, commonLabels: labels,
      alerts: [{ status: 'firing', labels, annotations: { simulated: 'true' }, startsAt: new Date(time).toISOString() }],
    });
    alerts.set(preferredProvider, { time, sent });
    return sent;
  }

  router.post('/', express.json(), async (req, res) => {
    const started = performance.now();
    const { customerId, provider: preferredProvider, amount, synthetic = true } = req.body ?? {};
    if (!isProvider(preferredProvider) || typeof customerId !== 'string' || !customerId.trim()
        || customerId !== customerId.trim() || customerId.length > 128
        || !Number.isInteger(amount) || amount < 1 || amount > 100000 || synthetic !== true) {
      return sendError(res, 400, 'BAD_REQUEST', 'Provide a demo provider, customer ID and integer amount between 1 and 100000.');
    }
    const probe = customerId.startsWith(probePrefix);
    if (probe && customerId !== probePrefix + preferredProvider) {
      return sendError(res, 400, 'BAD_REQUEST', 'Use the probe identity assigned to this provider.');
    }

    let primaryEnabled = true;
    if (!probe) {
      try {
        const params = new URLSearchParams({ provider: preferredProvider, customerId });
        const response = await fixture(`/routing?${params}`);
        const routing = await response.json();
        if (!response.ok || typeof routing?.primaryEnabled !== 'boolean') throw new Error('Invalid routing response');
        primaryEnabled = routing.primaryEnabled;
      } catch {
        return sendError(res, 502, 'PAYMENT_UNAVAILABLE', 'Payment routing is unavailable.', {
          preferredProvider, provider: preferredProvider,
        });
      }
    }

    const route = primaryEnabled ? 'primary' : 'fallback';
    const candidates = primaryEnabled ? [preferredProvider] : fallbackProviders(preferredProvider, customerId);
    const paymentId = `p-${randomUUID()}`;
    let provider = candidates[0]!;
    let result = await attempt(provider, paymentId, amount);
    for (const next of candidates.slice(1)) {
      // Only this explicit refusal establishes that the previous provider took no payment.
      if (!result.unavailable) break;
      provider = next;
      result = await attempt(provider, paymentId, amount);
    }

    const { success, upstreamStatus } = result;
    const latencyMs = Math.round(performance.now() - started);
    const payment = { paymentId, preferredProvider, provider, route };
    Object.assign(res.locals, { payment_id: paymentId, provider, route, upstream_status: upstreamStatus });
    // The controller starts its impact window when the alert opens the incident.
    if (!success && primaryEnabled && !probe) await alert(preferredProvider);
    void postController('/internal/orders', {
      ...payment, paymentCohort: preferredProvider, paymentCustomer: customerId, paymentRoute: route,
      paymentOutcome: success ? 'success' : 'error', amount, synthetic: true, upstreamStatus, latencyMs,
      ts: new Date().toISOString(),
    });

    if (success) return res.status(201).json(payment);
    return sendError(res, 502, 'PAYMENT_UNAVAILABLE', 'The demo payment provider could not take the payment.', {
      ...payment, upstreamStatus,
    });
  });

  return router;
}
