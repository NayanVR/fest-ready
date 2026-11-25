import { randomUUID } from 'node:crypto';
import express from 'express';
import { Counter, Registry } from 'prom-client';

type Provider = 'a' | 'b' | 'c';

const app = express();
const port = Number(process.env.PORT ?? 4003);
const adminSecret = process.env.ADMIN_SECRET;
const outages = new Map<Provider, 500>();
const parseJson = express.json();
const registry = new Registry();
const partnerRequests = new Counter({
  name: 'partner_requests_total',
  help: 'Shipment requests by courier provider and HTTP status',
  labelNames: ['provider', 'status'],
  registers: [registry],
});

function isProvider(value: unknown): value is Provider {
  return value === 'a' || value === 'b' || value === 'c';
}

function sendError(res: express.Response, status: number, error: string, message: string) {
  res.locals.error = error;
  res.status(status).json({ error, message });
}

app.use((_req, res, next) => {
  const requestId = randomUUID();
  res.on('finish', () => {
    const status = res.statusCode;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'partner-mock',
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      request_id: requestId,
      provider: res.locals.provider ?? null,
      status,
      order_id: res.locals.orderId,
      city: res.locals.city,
      error: res.locals.error,
      synthetic: true,
    }));
  });
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/metrics', async (_req, res) => {
  res.type(registry.contentType).send(await registry.metrics());
});

app.post('/:provider/shipments', (req, res, next) => {
  const { provider } = req.params;
  res.locals.provider = provider;
  if (!isProvider(provider)) {
    sendError(res, 404, 'UNKNOWN_PROVIDER', 'Unknown courier provider.');
    return;
  }
  res.on('finish', () => {
    partnerRequests.inc({ provider, status: String(res.statusCode) });
  });
  next();
}, parseJson, (req, res) => {
  const { provider } = req.params as { provider: Provider };
  const { orderId, city } = req.body ?? {};
  if (typeof orderId === 'string') res.locals.orderId = orderId;
  if (typeof city === 'string') res.locals.city = city;

  if (outages.has(provider)) {
    sendError(res, 500, 'PROVIDER_UNAVAILABLE', 'Courier provider is unavailable.');
    return;
  }
  res.json({ ref: `${provider}-${randomUUID()}` });
});

app.post('/admin/outage', (req, res, next) => {
  if (!adminSecret || req.get('X-Admin-Secret') !== adminSecret) {
    sendError(res, 401, 'UNAUTHORIZED', 'A valid admin secret is required.');
    return;
  }
  next();
}, parseJson, (req, res) => {
  const { provider, status } = req.body ?? {};
  if (!isProvider(provider) || (status !== 500 && status !== null)) {
    sendError(res, 400, 'BAD_REQUEST', 'Use provider a, b, or c and status 500 or null.');
    return;
  }

  res.locals.provider = provider;
  if (status === null) {
    outages.delete(provider);
  } else {
    outages.set(provider, status);
  }
  res.json({ outages: Object.fromEntries(outages) });
});

app.use((_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Route not found.');
});

const handleError: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error.status;
  if (status === 400 || status === 413 || status === 415) {
    sendError(res, status, 'BAD_REQUEST', 'The JSON request could not be read.');
    return;
  }
  sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
};
app.use(handleError);

app.listen(port, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(), service: 'partner-mock', level: 'info', port,
  }));
});
