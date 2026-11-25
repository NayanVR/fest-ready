import { isDeepStrictEqual } from "node:util";

const providers = ["alpha", "beta", "gamma"] as const;
type Provider = typeof providers[number];

const feature = { id: 1, name: "payment_primary_enabled" };
const project = "/api/v1/projects/1";
const versionsPath = "/api/v1/environments/1/features/1/versions/";
const segments = providers.flatMap((provider, index) =>
  ([false, true] as const).map((recovery) => ({
    id: 2 * index + (recovery ? 2 : 1),
    name: `payment-${provider}-${recovery ? "recovery" : "fallback"}`,
    provider,
    recovery,
  })),
);

function segmentBody(segment: typeof segments[number], split: number) {
  const { id, name, provider, recovery } = segment;
  const conditions: { id: number; operator: string; property: string; value: string }[] = [
    { id: 2 * id - 1, operator: "EQUAL", property: "paymentCohort", value: provider },
  ];
  if (recovery) conditions.push({ id: 2 * id, operator: "PERCENTAGE_SPLIT", property: "", value: String(split) });
  return { id, name, rules: [{ id, type: "ALL", conditions, rules: [] }] };
}

function isProvider(value: unknown): value is Provider {
  return providers.some((provider) => provider === value);
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

async function readBody(request: Request) {
  return object(await request.json().catch(() => null));
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

type Version = { uuid: string; overrides: Map<number, boolean> };

export function createPaymentDemo({ adminSecret, adminKey }: { adminSecret?: string; adminKey?: string }) {
  const outages = new Set<Provider>();
  const splits = new Map<number, number>();
  const versions: Version[] = [
    { uuid: crypto.randomUUID(), overrides: new Map(segments.map(({ id }) => [id, true])) },
  ];

  return async function handle(request: Request) {
    const { pathname, searchParams } = new URL(request.url);
    const { method } = request;

    if (method === "GET" && pathname === "/healthz") return Response.json({ ok: true });
    if (method === "GET" && pathname === "/status") {
      return Response.json({ providers: providers.map((id) => ({ id, available: !outages.has(id) })) });
    }

    if (method === "GET" && pathname === "/routing") {
      const provider = searchParams.get("provider");
      const customerId = searchParams.get("customerId");
      if (!isProvider(provider) || !customerId?.trim()) {
        return error(400, "BAD_REQUEST", "A demo provider and customerId are required.");
      }
      const probeProvider = providers.find((id) => customerId === `pay-probe-${id}`);
      if (probeProvider) {
        if (provider !== probeProvider) return error(400, "BAD_REQUEST", "Probe identity must match the provider.");
        return Response.json({ primaryEnabled: true });
      }

      const fallback = segments.find((segment) => segment.provider === provider && !segment.recovery)!;
      const recovery = segments.find((segment) => segment.provider === provider && segment.recovery)!;
      const split = splits.get(recovery.id) ?? 0;
      const bucket = Bun.hash(`${provider}:${customerId}`, 0n) % 10_000n;
      const matched = bucket < BigInt(split * 100) ? recovery : fallback;
      return Response.json({ primaryEnabled: versions[0].overrides.get(matched.id) });
    }

    const payment = pathname.match(/^\/providers\/([^/]+)\/payments$/);
    if (method === "POST" && payment) {
      const provider = payment[1];
      if (!isProvider(provider)) return error(404, "UNKNOWN_PROVIDER", "Unknown payment demo provider.");
      const body = await readBody(request);
      if (typeof body?.paymentId !== "string" || !body.paymentId.trim() ||
          typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
        return error(400, "BAD_REQUEST", "A paymentId and positive amount are required.");
      }
      if (outages.has(provider)) return error(503, "PROVIDER_UNAVAILABLE", "Simulated payment outage.");
      return Response.json({ provider, paymentId: body.paymentId }, { status: 201 });
    }

    if (method === "POST" && pathname === "/admin/outage") {
      if (!adminSecret || request.headers.get("X-Admin-Secret") !== adminSecret) {
        return error(401, "UNAUTHORIZED", "A valid admin secret is required.");
      }
      const body = await readBody(request);
      if (!isProvider(body?.provider) || (body.status !== 503 && body.status !== null)) {
        return error(400, "BAD_REQUEST", "Use a demo provider and status 503 or null.");
      }
      if (body.status === 503) outages.add(body.provider);
      else outages.delete(body.provider);
      return Response.json({ outages: Object.fromEntries([...outages].map((provider) => [provider, 503])) });
    }

    if (pathname.startsWith("/api/v1/")) {
      if (!adminKey || request.headers.get("Authorization") !== `Api-Key ${adminKey}`) {
        return error(401, "UNAUTHORIZED", "A valid fixture API key is required.");
      }
      if (method === "GET" && pathname === `${project}/features/`) {
        const term = searchParams.get("search") ?? "";
        return Response.json({ results: feature.name.includes(term) ? [feature] : [] });
      }
      if (method === "GET" && pathname === `${project}/segments/`) {
        const term = searchParams.get("q") ?? "";
        const results = segments.filter(({ name }) => name.includes(term)).map(({ id, name }) => ({ id, name }));
        return Response.json({ results });
      }
      const segmentPath = pathname.match(/^\/api\/v1\/projects\/1\/segments\/(\d+)\/$/);
      if (segmentPath && (method === "GET" || method === "PUT")) {
        const segment = segments.find(({ id }) => String(id) === segmentPath[1]);
        if (!segment) return error(404, "NOT_FOUND", "Segment does not exist.");
        if (method === "GET") return Response.json(segmentBody(segment, splits.get(segment.id) ?? 0));

        if (!segment.recovery) return error(400, "BAD_REQUEST", "Only recovery splits can be edited.");
        const body = await readBody(request);
        const rules = Array.isArray(body?.rules) ? body.rules : [];
        const value = rules[0]?.conditions?.[1]?.value;
        if (typeof value !== "string" || !/^(?:0|[1-9]\d?|100)$/.test(value)) {
          return error(400, "BAD_REQUEST", "Use an integer split from 0 to 100.");
        }
        const updated = segmentBody(segment, Number(value));
        if (body?.name !== updated.name || !isDeepStrictEqual(rules, updated.rules)) {
          return error(400, "BAD_REQUEST", "Keep the existing segment name, rule, and conditions.");
        }
        splits.set(segment.id, Number(value));
        return Response.json(updated);
      }
      if (pathname === versionsPath && method === "GET") {
        return Response.json({ results: versions.map(({ uuid }, index) => ({ uuid, is_live: index === 0 })) });
      }
      if (pathname === versionsPath && method === "POST") {
        const body = await readBody(request);
        const updates = body?.feature_states_to_update;
        if (body?.publish_immediately !== true || !Array.isArray(updates) || updates.length === 0) {
          return error(400, "BAD_REQUEST", "Immediately publish at least one existing segment override.");
        }
        const overrides = new Map(versions[0].overrides);
        for (const entry of updates) {
          const update = object(entry);
          const segmentId = object(update?.feature_segment)?.segment;
          const value = object(update?.feature_state_value);
          if (typeof segmentId !== "number" || !overrides.has(segmentId) || typeof update?.enabled !== "boolean" ||
              value?.type !== "unicode" || value.string_value !== null) {
            return error(400, "BAD_REQUEST", "Use existing segment IDs and boolean flag states.");
          }
          overrides.set(segmentId, update.enabled);
        }
        const uuid = crypto.randomUUID();
        versions.unshift({ uuid, overrides });
        return Response.json({ uuid, is_live: true }, { status: 201 });
      }
      if (method === "GET" && pathname.startsWith(versionsPath) && pathname.endsWith("/featurestates/")) {
        const uuid = pathname.slice(versionsPath.length, -"/featurestates/".length);
        const version = versions.find((candidate) => candidate.uuid === uuid);
        if (!version) return error(404, "NOT_FOUND", "Version does not exist.");
        return Response.json([
          { enabled: true, feature_segment: null },
          ...segments.map(({ id, recovery }) => ({
            enabled: version.overrides.get(id),
            feature_segment: { segment: id, priority: recovery ? 0 : 1 },
          })),
        ]);
      }
    }
    return error(404, "NOT_FOUND", "Route not found.");
  };
}

if (import.meta.main) {
  const handle = createPaymentDemo({
    adminSecret: process.env.ADMIN_SECRET,
    adminKey: process.env.PAYMENT_DEMO_ADMIN_KEY,
  });
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 4300),
    maxRequestBodySize: 16_384,
    async fetch(request) {
      const response = await handle(request);
      const status = response.status;
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        service: "payment-demo",
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        request_id: crypto.randomUUID(),
        method: request.method,
        status,
        synthetic: true,
      }));
      return response;
    },
  });
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "payment-demo", level: "info", port: server.port }));
}
