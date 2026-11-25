import { randomUUID } from 'node:crypto';
import express from 'express';
import { Flagsmith } from 'flagsmith-nodejs';
import { Counter, Histogram, Registry } from 'prom-client';
import { customerRoute, deliveryOptions } from './customers.ts';
import { paymentRoutes } from './payments.ts';

const app = express();
const port = Number(process.env.PORT ?? 4001);
const partnerUrl = (process.env.PARTNER_URL || 'http://localhost:4003').replace(/\/+$/, '');
const controllerUrl = process.env.CONTROLLER_URL?.replace(/\/+$/, '');
const environmentKey = process.env.FLAGSMITH_SERVER_KEY;
const deliveryFlagKey = 'home_delivery_enabled';
const flagsmith = environmentKey ? new Flagsmith({
  environmentKey,
  enableLocalEvaluation: true,
  environmentRefreshIntervalSeconds: 5,
}) : undefined;

const registry = new Registry();
const orders = new Counter({
  name: 'shop_orders_total',
  help: 'Order attempts by city, mode and result',
  labelNames: ['city', 'mode', 'result'],
  registers: [registry],
});
const flagEvaluations = new Counter({
  name: 'shop_delivery_flag_evaluations_total',
  help: 'Delivery flag evaluations by city and value',
  labelNames: ['city', 'value'],
  registers: [registry],
});
const dispatches = new Counter({
  name: 'courier_dispatch_total',
  help: 'Courier dispatch attempts by city, provider and status',
  labelNames: ['city', 'provider', 'status'],
  registers: [registry],
});
const dispatchDuration = new Histogram({
  name: 'courier_dispatch_duration_seconds',
  help: 'Courier dispatch duration in seconds',
  labelNames: ['city', 'provider'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

type CustomerRoute = NonNullable<ReturnType<typeof customerRoute>>;

async function deliveryEnabled(customerId: string, city: CustomerRoute['city']) {
  const enabled = flagsmith
    ? (await flagsmith.getIdentityFlags(customerId, { city })).isFeatureEnabled(deliveryFlagKey)
    : true;
  flagEvaluations.inc({ city, value: String(enabled) });
  return enabled;
}

async function postJson(url: string, body: object, timeoutMs: number) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  void response.body?.cancel().catch(() => {});
  return response.status;
}

function postController(path: string, body: object) {
  if (!controllerUrl) return Promise.resolve();
  return postJson(`${controllerUrl}${path}`, body, 500).then(() => {}, () => {});
}

async function dispatch(orderId: string, { city, provider }: CustomerRoute) {
  const stopTimer = dispatchDuration.startTimer({ city, provider });
  let status: number | 'timeout';
  try {
    status = await postJson(`${partnerUrl}/${provider}/shipments`, { orderId, city }, 2000);
  } catch {
    status = 'timeout';
  } finally {
    stopTimer();
  }
  // Keep the original HTTP status in the response and event, with a bounded metric label.
  const metricStatus = status === 200 || status === 'timeout' ? String(status) : '500';
  dispatches.inc({ city, provider, status: metricStatus });
  return status;
}

function sendError(res: express.Response, status: number, error: string, message: string, details = {}) {
  res.locals.error = error;
  res.status(status).json({ error, message, ...details });
}

app.use((_req, res, next) => {
  const requestId = randomUUID();
  res.on('finish', () => {
    const status = res.statusCode;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'shop-api',
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      request_id: requestId,
      status,
      synthetic: true,
      ...res.locals,
    }));
  });
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/metrics', async (_req, res) => {
  res.type(registry.contentType).send(await registry.metrics());
});

app.get('/api/options', async (req, res) => {
  const customerId = req.query.customerId;
  const route = customerRoute(customerId);
  if (typeof customerId !== 'string' || !route) {
    return sendError(res, 404, 'UNKNOWN_CUSTOMER', 'Unknown customer ID.');
  }

  const { city } = route;
  res.locals.city = city;
  const enabled = await deliveryEnabled(customerId, city);
  res.json({ customerId, city, options: deliveryOptions(enabled), flags: { [deliveryFlagKey]: enabled } });
});

app.post('/api/orders', express.json(), async (req, res) => {
  const started = performance.now();
  const { customerId, mode, amount = 1000, synthetic = true } = req.body ?? {};
  if (typeof customerId !== 'string' || (mode !== 'delivery' && mode !== 'pickup')
      || !Number.isInteger(amount) || amount < 1 || amount > 100000 || typeof synthetic !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'Provide a customer ID, a valid mode, and valid optional amount and synthetic fields.');
  }
  const route = customerRoute(customerId);
  if (!route) return sendError(res, 404, 'UNKNOWN_CUSTOMER', 'Unknown customer ID.');

  const { city } = route;
  const orderId = `o-${randomUUID()}`;
  const provider = mode === 'delivery' ? route.provider : null;
  const shipment = provider ? { provider } : {};
  Object.assign(res.locals, { city, order_id: orderId, synthetic, ...shipment });

  const deliveryFlag = await deliveryEnabled(customerId, city);
  const upstreamStatus = provider && deliveryFlag ? await dispatch(orderId, route) : null;
  let outcome: 'success' | 'error' | 'rejected' = 'success';
  let errorCode: 'PROVIDER_FAILED' | 'DELIVERY_UNAVAILABLE' | null = null;

  if (provider && !deliveryFlag) {
    outcome = 'rejected';
    errorCode = 'DELIVERY_UNAVAILABLE';
  } else if (upstreamStatus !== null && upstreamStatus !== 200) {
    outcome = 'error';
    errorCode = 'PROVIDER_FAILED';
  }
  if (upstreamStatus !== null) res.locals.upstream_status = upstreamStatus;

  const latencyMs = Math.round(performance.now() - started);
  orders.inc({ city, mode, result: outcome });
  void postController('/internal/orders', {
    orderId, customerId, city, mode, provider, deliveryFlag, outcome, errorCode,
    upstreamStatus, amount, latencyMs, synthetic, ts: new Date().toISOString(),
  });

  if (errorCode === 'DELIVERY_UNAVAILABLE') {
    return sendError(res, 409, errorCode, 'Home delivery is paused in your city. Pickup is available.', { outcome });
  }
  if (errorCode === 'PROVIDER_FAILED') {
    return sendError(res, 502, errorCode, "The courier provider couldn't take the order. Try pickup.", {
      outcome, provider, upstreamStatus,
    });
  }
  res.status(201).json({ orderId, customerId, city, mode, ...shipment, amount, outcome, latencyMs });
});

const paymentDemoUrl = process.env.PAYMENT_DEMO_URL?.trim();
if (paymentDemoUrl) {
  app.use('/api/payments', paymentRoutes(paymentDemoUrl, process.env.ADMIN_SECRET, postController, sendError));
}

app.use((_req, res) => sendError(res, 404, 'NOT_FOUND', 'Route not found.'));
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error.status && error.status >= 400 && error.status < 500) {
    return sendError(res, 400, 'BAD_REQUEST', 'The JSON request could not be read.');
  }
  sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
});

app.listen(port, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'shop-api', level: 'info', port }));
});
