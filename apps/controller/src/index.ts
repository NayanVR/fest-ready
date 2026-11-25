import { timingSafeEqual } from "node:crypto";
import { openDb } from "./db.ts";
import {
  ack, act, auditRows, fault, findingsForIncident, findingsFromNubi, getIncident, incidentEvidence, listIncidents, onAlert, serial,
  storeEvent, writePlaybook, type Result,
} from "./incidents.ts";
import { log } from "./log.ts";
import { startLoops } from "./loops.ts";
import { handleMcp } from "./mcp.ts";
import { getPlaybook, listPlaybooks, seedPlaybooks } from "./playbooks.ts";
import { toCsv } from "./recovery.ts";
import { playbooksWithReadiness, readiness, state } from "./status.ts";

const db = openDb();
const seeded = seedPlaybooks(db);
const port = Number(process.env.PORT || 4100);

const json = (body: unknown, status = 200) => Response.json(body, { status });
const send = (r: Result) => json(r.body, r.status);
const fail = (status: number, error: string, message: string) => json({ error, message }, status);

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

type Req = Request & { params: Record<string, string> };

// Write endpoints need X-Admin-Secret. Fails closed when ADMIN_SECRET is unset.
function admin(handler: (req: Req) => Promise<Response> | Response) {
  return (req: Req) => {
    const want = Buffer.from(process.env.ADMIN_SECRET ?? "");
    const got = Buffer.from(req.headers.get("x-admin-secret") ?? "");
    if (!want.length || want.length !== got.length || !timingSafeEqual(want, got))
      return fail(401, "UNAUTHORIZED", "missing or wrong X-Admin-Secret");
    return handler(req);
  };
}

const actor = (b: any) => (typeof b?.actor === "string" && b.actor.trim() ? b.actor.trim() : "operator");
const save = (update: boolean) =>
  admin(async (req) => {
    const b = await body(req);
    return send(await serial(() => writePlaybook(db, b, actor(b), update ? req.params.id : undefined)));
  });
const action = (type: "approve" | "advance" | "rollback") =>
  admin(async (req) => {
    const b = await body(req);
    const ev = type === "advance" ? { type, guardrailPass: false, cooldownLeftMs: 0 } : { type };
    return send(await serial(() => act(db, req.params.id, actor(b), ev as any)));
  });

// One JSON log line per request (except /healthz): Bun.serve routes have no middleware, so wrap every handler.
type Handler = (req: Req) => Response | Promise<Response>;
function logged(routes: Record<string, Handler | Record<string, Handler>>) {
  const wrap = (path: string, h: Handler): Handler => async (req) => {
    const start = Date.now();
    const res = await h(req);
    if (path !== "/healthz")
      log("info", "request", { method: req.method, path: new URL(req.url).pathname, status: res.status, ms: Date.now() - start });
    return res;
  };
  return Object.fromEntries(Object.entries(routes).map(([path, r]) =>
    [path, typeof r === "function" ? wrap(path, r) : Object.fromEntries(Object.entries(r).map(([m, h]) => [m, wrap(path, h)]))]));
}

const server = Bun.serve({
  port,
  routes: logged({
    "/healthz": () => json({ ok: true }),

    "/internal/orders": {
      POST: async (req) => {
        const b = await body(req);
        if (!b || typeof b !== "object" || Array.isArray(b)) return fail(400, "BAD_REQUEST", "order event must be a JSON object");
        storeEvent(db, b);
        return json({ ok: true }, 202);
      },
    },
    "/webhooks/alertmanager": { POST: async (req) => { const b = await body(req); return send(await serial(() => onAlert(db, b))); } },

    // No admin secret (CONTRACTS §3.5): reachable only in-cluster or through the NudgeBee proxy agent.
    "/mcp": (req) =>
      handleMcp(req, { listPlaybooks: () => listPlaybooks(db), submitFindings: (input) => serial(() => findingsFromNubi(db, input)) }),

    "/api/state": { GET: async () => json(await state(db)) },
    "/api/playbooks": { GET: async () => json(await playbooksWithReadiness(db)), POST: save(false) },
    "/api/playbooks/:id": {
      GET: async (req) => {
        const pb = getPlaybook(db, req.params.id);
        return pb ? json({ ...pb, ...(await readiness(db, pb)) }) : fail(404, "NOT_FOUND", `${req.params.id} not found`);
      },
      PUT: save(true),
    },
    "/api/playbooks/:id/check": {
      POST: admin(async (req) => {
        const pb = getPlaybook(db, req.params.id);
        return pb ? json({ ...pb, ...(await readiness(db, pb, true)) }) : fail(404, "NOT_FOUND", `${req.params.id} not found`);
      }),
    },
    "/api/fault": { POST: admin(async (req) => send(await fault(db, await body(req)))) },

    "/api/incidents": { GET: () => json(listIncidents(db)) },
    "/api/incidents/:id": {
      GET: (req) => {
        const inc = getIncident(db, req.params.id);
        return inc ? json(inc) : fail(404, "NOT_FOUND", `${req.params.id} not found`);
      },
    },
    "/api/incidents/:id/evidence": {
      GET: (req) => {
        const r = incidentEvidence(db, req.params.id);
        if (r.status !== 200 || new URL(req.url).searchParams.get("format") !== "csv") return send(r);
        const e = r.body as { incidentId: string; rows: Record<string, unknown>[] };
        return new Response(toCsv(e.rows), {
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${e.incidentId}-evidence.csv"` },
        });
      },
    },
    "/api/incidents/:id/ack": {
      POST: admin(async (req) => { const b = await body(req); return send(await serial(() => ack(db, req.params.id, b?.owner))); }),
    },
    "/api/incidents/:id/findings": {
      POST: admin(async (req) => { const b = await body(req); return send(await serial(() => findingsForIncident(db, req.params.id, b))); }),
    },
    "/api/incidents/:id/approve": { POST: action("approve") },
    "/api/incidents/:id/advance": { POST: action("advance") },
    "/api/incidents/:id/rollback": { POST: action("rollback") },
    "/api/incidents/:id/close": {
      POST: admin(async (req) => {
        const b = await body(req);
        if (typeof b?.note !== "string" || !b.note.trim()) return fail(400, "BAD_REQUEST", "note is required");
        return send(await serial(() => act(db, req.params.id, actor(b), { type: "close" }, b.note)));
      }),
    },
    "/api/audit": { GET: (req) => json(auditRows(db, new URL(req.url).searchParams.get("incident") ?? undefined)) },
  }) as any,
  fetch: () => fail(404, "NOT_FOUND", "no such route"),
  error: (e) => {
    log("error", "unhandled", { error: e.message });
    return fail(500, "INTERNAL", e.message);
  },
});

startLoops(db);
log("info", "controller listening", { port: server.port, seededPlaybooks: seeded });
