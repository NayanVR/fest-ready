// Incidents as tickets (ARCHITECTURE §9.4): storage, findings, actions, audit and the read shapes in CONTRACTS §3.4.
// No business names: everything comes from the playbook.
import type { Database } from "bun:sqlite";
import { apply, warm, type FlagStateView } from "./flagsmith.ts";
import { log } from "./log.ts";
import { canaryStep, checkFindings, cooldownLeftMs, INVESTIGATING, parseFindings, statusOf, transition, type Event } from "./machine.ts";
import type { FindingsResult } from "./mcp.ts";
import { getPlaybook, isProbe, type Playbook } from "./playbooks.ts";
import { canaryEvents, evaluateGuardrail, evidence, impact, probeStatus, type Ev, type ProbeResult } from "./recovery.ts";

export type Result = { status: number; body: unknown };
const err = (status: number, error: string, message: string): Result => ({ status, body: { error, message } });

type Row = {
  n: number; alert: string; state: string; owner: string | null; playbook: string | null; value: string | null;
  split: number; step_started_at: number | null; fallback_at: number | null; rolled_back_at: number | null;
  opened_at: string; mitigated_at: string | null; resolved_at: string | null; closed_at: string | null; close_note: string | null;
};

export const incidentId = (n: number) => `INC-${String(n).padStart(4, "0")}`;
const parseId = (id: string) => (/^INC-\d+$/.test(id) ? Number(id.slice(4)) : -1);
const nowIso = () => new Date().toISOString();
const getRow = (db: Database, id: string) => db.query<Row, [number]>("SELECT * FROM incidents WHERE n = ?").get(parseId(id));
const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso));

// ponytail: one global lock for every write (Flagsmith calls included); per-incident locks if it ever matters
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T> | T): Promise<T> {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

// ---------- audit ----------

type Flags = { before?: FlagStateView | null; after?: FlagStateView | null; readBack?: FlagStateView | null };

function audit(db: Database, incident: number | null, actor: string, action: string, result: string, flags: Flags = {}) {
  const j = (x?: FlagStateView | null) => (x ? JSON.stringify(x) : null);
  db.query("INSERT INTO audit (ts, incident, actor, action, before, after, read_back, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(nowIso(), incident, actor, action, j(flags.before), j(flags.after), j(flags.readBack), result);
  log("info", "audit", { incident: incident === null ? null : incidentId(incident), actor, action, result });
}

// Newest first.
export function auditRows(db: Database, incident?: string) {
  const rows = incident
    ? db.query<any, [number]>("SELECT * FROM audit WHERE incident = ? ORDER BY id DESC").all(parseId(incident))
    : db.query<any, []>("SELECT * FROM audit ORDER BY id DESC LIMIT 500").all();
  const p = (s: string | null) => (s === null ? null : JSON.parse(s));
  return rows.map((r) => ({
    ts: r.ts, incidentId: r.incident === null ? null : incidentId(r.incident), actor: r.actor, action: r.action,
    before: p(r.before), after: p(r.after), readBack: p(r.read_back), result: r.result,
  }));
}

// ---------- order events and probe results ----------

export function storeEvent(db: Database, body: Record<string, unknown>) {
  db.query("INSERT INTO order_events (received_at, body) VALUES (?, ?)").run(Date.now(), JSON.stringify(body));
}

export const eventsSince = (db: Database, since: number): Ev[] =>
  db.query<{ received_at: number; body: string }, [number]>("SELECT received_at, body FROM order_events WHERE received_at >= ? ORDER BY id")
    .all(since).map((r) => ({ ts: r.received_at, body: JSON.parse(r.body) }));

export function recordProbe(db: Database, n: number, ok: boolean, status: number | null, error: string | null, ts = Date.now()) {
  db.query("INSERT INTO probe_results (incident, ts, ok, status, error) VALUES (?, ?, ?, ?, ?)").run(n, ts, ok ? 1 : 0, status, error);
}

export const probeResults = (db: Database, n: number, since: number): ProbeResult[] =>
  db.query<{ ts: number; ok: number }, [number, number]>("SELECT ts, ok FROM probe_results WHERE incident = ? AND ts >= ? ORDER BY id")
    .all(n, since).map((r) => ({ ts: r.ts, ok: !!r.ok }));

// ---------- guardrail view ----------

// Guardrail for the current canary step (order events via the playbook's `events` fields).
// ponytail: events only; the playbook's PromQL `health` path is unverified (ARCHITECTURE §9.3 [VERIFY]), add when checked
export function stepGuardrail(db: Database, r: Row, pb: Playbook, now = Date.now()) {
  return evaluateGuardrail(pb, r.value!, eventsSince(db, r.step_started_at!), r.step_started_at!, now);
}

function recoveryView(db: Database, r: Row, pb: Playbook, now = Date.now()) {
  const g = pb.recovery.guardrail;
  const base = {
    state: r.state, splitPercent: r.split, observedSharePercent: null as number | null,
    samples: 0, minSamples: g.min_samples, errorRate: null as number | null, maxErrorRate: g.max_error_rate,
    consecutiveErrors: 0, guardrail: "wait" as "pass" | "wait" | "breach", advanceAllowed: false, reason: null as string | null,
  };
  if (canaryStep(r.state) !== null && r.step_started_at !== null) {
    const gr = stepGuardrail(db, r, pb, now);
    // Observed share: identities in the canary cohort / identities seen for the value this step (probes excluded).
    const all = eventsSince(db, r.step_started_at).filter((x) => x.body[pb.events.dimension_field] === r.value && !isProbe(pb, x.body));
    const ids = (xs: Ev[]) => new Set(xs.map((x) => x.body[pb.events.identity_field])).size;
    const cohort = canaryEvents(pb, r.value!, all, r.step_started_at);
    return {
      ...base, observedSharePercent: ids(all) ? Math.round((1000 * ids(cohort)) / ids(all)) / 10 : null,
      samples: gr.samples, errorRate: gr.errorRate, consecutiveErrors: gr.consecutiveErrors,
      guardrail: gr.guardrail, advanceAllowed: gr.advanceAllowed, reason: gr.reason ?? gr.breach,
    };
  }
  if (r.state === "PROBE_OK") {
    const left = cooldownLeftMs(pb, r.rolled_back_at, now);
    return { ...base, guardrail: "pass" as const, advanceAllowed: left === 0, reason: left ? `cooldown after rollback: ${Math.ceil(left / 1000)}s left` : null };
  }
  if (r.state === "FALLBACK") return { ...base, reason: `waiting for the provider probe to be healthy for ${pb.probe.healthy_for}` };
  return { ...base, reason: r.state === "FINDINGS" ? "approve the fallback first" : null };
}

// ---------- read shapes ----------

const title = (r: Row, pb: Playbook | null) =>
  pb && r.value ? `${r.alert}: ${pb.dimension.name} ${r.value}` : `${r.alert}: investigating`;

export const listIncidents = (db: Database) =>
  db.query<Row, []>("SELECT * FROM incidents ORDER BY n DESC").all().map((r) => ({
    id: incidentId(r.n), title: title(r, r.playbook ? getPlaybook(db, r.playbook) : null), status: statusOf(r.state), owner: r.owner,
    alert: r.alert, playbook: r.playbook, value: r.value, openedAt: r.opened_at, closedAt: r.closed_at,
  }));

export const countOpenIncidents = (db: Database) =>
  db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM incidents WHERE state NOT IN ('NORMAL', 'CLOSED')").get()!.n;

function latestFindings(db: Database, n: number) {
  const f = db.query<any, [number]>("SELECT * FROM findings WHERE incident = ? ORDER BY id DESC LIMIT 1").get(n);
  return f && { source: f.source, cause: f.cause, summary: f.summary, nubiUrl: f.nubi_url, evidence: JSON.parse(f.evidence), submittedAt: f.submitted_at };
}

// Failures start before the alert fires (1m rate + `for: 1m`), so impact and evidence look back a little before openedAt.
const LOOKBACK_MS = 5 * 60_000;

export function getIncident(db: Database, id: string, now = Date.now()) {
  const r = getRow(db, id);
  if (!r) return null;
  const pb = r.playbook ? getPlaybook(db, r.playbook) : null;
  const iid = incidentId(r.n);
  const ready = pb && r.value;
  const from = ms(r.opened_at)! - LOOKBACK_MS;
  const until = ms(r.closed_at) ?? now;
  return {
    id: iid, title: title(r, pb), status: statusOf(r.state), owner: r.owner, alert: r.alert,
    playbook: ready ? r.playbook : null, value: ready ? r.value : null,
    findings: latestFindings(db, r.n),
    openedAt: r.opened_at, mitigatedAt: r.mitigated_at, resolvedAt: r.resolved_at, closedAt: r.closed_at, closeNote: r.close_note,
    recovery: ready ? recoveryView(db, r, pb, now) : null,
    probe: ready && r.fallback_at !== null
      ? (({ healthySince, ...p }) => ({ ...p, healthySince: healthySince === null ? null : new Date(healthySince).toISOString() }))(
          probeStatus(pb, probeResults(db, r.n, r.fallback_at), r.fallback_at, now))
      : null,
    impact: ready ? impact(pb, r.value!, eventsSince(db, from).filter((x) => x.ts <= until), from, ms(r.mitigated_at), until) : null,
    timeline: auditRows(db, iid).reverse().map(({ ts, actor, action, result }) => ({ ts, actor, action, result })),
  };
}

export function incidentEvidence(db: Database, id: string, now = Date.now()): Result {
  const r = getRow(db, id);
  if (!r) return err(404, "NOT_FOUND", `${id} not found`);
  const pb = r.playbook ? getPlaybook(db, r.playbook) : null;
  if (!pb || !r.value) return err(409, "NO_FINDINGS", "no playbook and value yet, so nothing to report on");
  const from = ms(r.opened_at)! - LOOKBACK_MS;
  const until = ms(r.closed_at) ?? now;
  const e = evidence(pb, r.value, eventsSince(db, from).filter((x) => x.ts <= until), from, until);
  return { status: 200, body: { incidentId: incidentId(r.n), playbook: pb.id, dimension: pb.dimension.name, ...e } };
}

// ---------- alerts and findings ----------

// Alertmanager webhook: firing → open an Investigating ticket, or dedupe into the open one. Firing again while
// Recovering (a canary step) takes the automatic rollback path (actor "alertmanager"). Resolved notices are logged.
export async function onAlert(db: Database, payload: any): Promise<Result> {
  if (!payload || !Array.isArray(payload.alerts)) return err(400, "BAD_REQUEST", "expected an Alertmanager webhook payload");
  const touched: string[] = [];
  for (const a of payload.alerts) {
    const name = a?.labels?.alertname;
    if (typeof name !== "string") continue;
    const open = db.query<Row, [string]>("SELECT * FROM incidents WHERE alert = ? AND state != 'CLOSED' ORDER BY n DESC LIMIT 1").get(name);
    if (a.status === "resolved") {
      if (open) audit(db, open.n, "alertmanager", `alert ${name} resolved`, "ok");
      else log("info", "alert resolved, no open incident", { alert: name });
      continue;
    }
    if (!open) {
      const { n } = db.query<{ n: number }, [string, string]>(
        "INSERT INTO incidents (alert, state, opened_at) VALUES (?, 'INVESTIGATING', ?) RETURNING n").get(name, nowIso())!;
      audit(db, n, "alertmanager", `alert ${name} fired: incident opened`, "ok");
      touched.push(incidentId(n));
    } else if (canaryStep(open.state) !== null) {
      await act(db, incidentId(open.n), "alertmanager", { type: "rollback" }, `automatic rollback: alert ${name} fired again during recovery`);
      touched.push(incidentId(open.n));
    } else if (open.state === "NORMAL") {
      // A regression after Resolved reopens the same ticket; the fallback is re-applied only by an operator's Approve.
      db.query("UPDATE incidents SET state = 'FINDINGS', resolved_at = NULL WHERE n = ?").run(open.n);
      audit(db, open.n, "alertmanager", `alert ${name} fired again: ticket reopened (NORMAL → FINDINGS)`, "ok");
      touched.push(incidentId(open.n));
    } else {
      audit(db, open.n, "alertmanager", `alert ${name} fired again (deduplicated)`, "ok");
      touched.push(incidentId(open.n));
    }
  }
  return { status: 200, body: { ok: true, incidents: touched } };
}

// Findings from the operator form (source "operator") or MCP (source "nubi"). `summary` is stored byte-for-byte.
function submitFindings(db: Database, row: Row | null, body: any, source: "operator" | "nubi"): Result {
  const actor = source === "operator" && typeof body?.actor === "string" && body.actor.trim() ? body.actor.trim() : source;
  const f = parseFindings(body);
  if (typeof f === "string") return err(400, "BAD_REQUEST", f);
  const open = row && INVESTIGATING.includes(row.state) ? row : null;
  const pb = f.playbook ? getPlaybook(db, f.playbook) : null;
  const bad = checkFindings(f, open, pb);
  if (bad) {
    if (row) audit(db, row.n, actor, `findings rejected (${bad.error}): ${bad.message}`, "rejected");
    return err(bad.error === "NO_OPEN_INCIDENT" ? 409 : 422, bad.error, bad.message);
  }
  const t = transition(open!.state, { type: "findings", manual: f.playbook === null }, []) as { to: string };
  db.transaction(() => {
    db.query(`INSERT INTO findings (incident, source, playbook, value, cause, summary, evidence, nubi_url, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(open!.n, source, f.playbook, f.value, f.cause, f.summary, JSON.stringify(f.evidence), f.nubiUrl, nowIso());
    db.query("UPDATE incidents SET state = ?, playbook = ?, value = ? WHERE n = ?").run(t.to, f.playbook, f.playbook ? f.value : null, open!.n);
    audit(db, open!.n, actor, f.playbook ? `findings (${source}): ${f.playbook} / ${f.value} / ${f.cause}` : `findings (${source}): no playbook fits (${f.cause})`, "ok");
  })();
  // Look up Flagsmith IDs and state now so Approve is one write + one read-back. Best effort.
  if (pb) warm(pb, f.value!).catch((e) => log("warn", "flagsmith warm-up failed", { error: (e as Error).message }));
  return { status: 200, body: { accepted: true, incident: incidentId(open!.n) } };
}

export function findingsForIncident(db: Database, id: string, body: unknown): Result {
  const row = getRow(db, id);
  if (!row) return err(404, "NOT_FOUND", `${id} not found`);
  return submitFindings(db, row, body, "operator");
}

// MCP submit_findings: the newest Investigating incident whose alert is in the playbook's match.alerts
// (the newest Investigating incident when playbook is null or none match, so the §3.5 checks can say why).
export function findingsFromNubi(db: Database, body: any): FindingsResult {
  const investigating = db.query<Row, []>("SELECT * FROM incidents WHERE state IN ('INVESTIGATING', 'FINDINGS', 'MANUAL') ORDER BY n DESC").all();
  const pb = typeof body?.playbook === "string" ? getPlaybook(db, body.playbook) : null;
  const row = investigating.find((r) => pb?.match.alerts.includes(r.alert)) ?? investigating[0] ?? null;
  const r = submitFindings(db, row, body, "nubi");
  const b = r.body as any;
  return r.status === 200 ? b : { accepted: false, error: b.error, message: b.message };
}

export function ack(db: Database, id: string, owner: unknown): Result {
  const row = getRow(db, id);
  if (!row) return err(404, "NOT_FOUND", `${id} not found`);
  if (typeof owner !== "string" || !owner.trim()) return err(400, "BAD_REQUEST", "owner is required");
  db.query("UPDATE incidents SET owner = ? WHERE n = ?").run(owner, row.n);
  audit(db, row.n, owner, "ack: took ownership", "ok");
  return { status: 200, body: getIncident(db, id) };
}

// ---------- actions ----------

const fmt = (s: FlagStateView | null | undefined) => (s ? `fallback ${s.fallbackActive ? "on" : "off"}, split ${s.splitPercent}%` : "unknown");

function label(ev: Event, from: string, to: string, fromSplit: number, toSplit?: number) {
  if (toSplit !== undefined && toSplit !== fromSplit) return `split ${fromSplit}% → ${toSplit}% (${from} → ${to})`;
  return `${ev.type}: ${from} → ${to}`;
}

// Runs one state-machine event: applies the Flagsmith changes it needs, checks the read-back, then saves.
// Audit: before = last state read, after = requested, readBack = read after the write.
export async function act(db: Database, id: string, actor: string, ev: Event, note?: string, now = Date.now()): Promise<Result> {
  const row = getRow(db, id);
  if (!row) return err(404, "NOT_FOUND", `${id} not found`);
  const pb = row.playbook ? getPlaybook(db, row.playbook) : null;
  if (row.playbook && !pb) return err(409, "UNKNOWN_PLAYBOOK", `playbook ${row.playbook} no longer exists`);
  if (ev.type === "advance" && pb)
    ev = {
      type: "advance",
      guardrailPass: canaryStep(row.state) !== null && row.step_started_at !== null && stepGuardrail(db, row, pb, now).advanceAllowed,
      cooldownLeftMs: cooldownLeftMs(pb, row.rolled_back_at, now),
    };

  const t = transition(row.state, ev, pb?.recovery.steps ?? []);
  if ("error" in t) {
    audit(db, row.n, actor, `${ev.type} refused (${t.error}): ${t.message}`, "rejected");
    return err(409, t.error, t.message);
  }
  if (t.to === row.state && t.fallback === undefined && t.split === undefined) return { status: 200, body: getIncident(db, id) };

  let flags: Flags = {};
  let action = label(ev, row.state, t.to, row.split, t.split);
  if (t.fallback !== undefined || t.split !== undefined) {
    try {
      const r = await apply(pb!, row.value!, { fallback: t.fallback, split: t.split }, `${id} ${ev.type} by ${actor}`);
      const want = t.fallback === undefined ? null : t.fallback ? pb!.flag.fallback : pb!.flag.normal;
      const after: FlagStateView = {
        fallbackActive: want ? t.fallback! : r.readBack.fallbackActive,
        fallbackEnabled: want ? want.enabled : r.readBack.fallbackEnabled,
        fallbackValue: r.readBack.fallbackValue,
        splitPercent: t.split ?? r.readBack.splitPercent,
      };
      flags = { before: r.before, after, readBack: r.readBack };
      action += ` [${fmt(r.before)} → ${fmt(r.readBack)}]`;
      if (r.readBack.fallbackActive !== after.fallbackActive || r.readBack.splitPercent !== after.splitPercent) {
        audit(db, row.n, actor, `${action}: read-back does not match`, "error", flags);
        return err(502, "READBACK_MISMATCH", "Flagsmith read-back does not match the requested state; state unchanged");
      }
    } catch (e) {
      audit(db, row.n, actor, `${ev.type} failed: ${(e as Error).message}`, "error");
      return err(502, "FLAGSMITH_ERROR", (e as Error).message);
    }
  }
  if (note) action += `: ${note}`;

  const iso = new Date(now).toISOString();
  const step = canaryStep(t.to);
  const refallback = ev.type === "approve" || ev.type === "rollback";
  db.query(`UPDATE incidents SET state = ?, split = COALESCE(?, split), step_started_at = ?,
      mitigated_at = CASE WHEN ? = 'FALLBACK' AND mitigated_at IS NULL THEN ? ELSE mitigated_at END,
      resolved_at = CASE WHEN ? = 'NORMAL' THEN ? ELSE resolved_at END,
      closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE closed_at END,
      close_note = CASE WHEN ? = 'CLOSED' THEN ? ELSE close_note END,
      fallback_at = ?, rolled_back_at = ?
    WHERE n = ?`).run(
    t.to, t.split ?? null, step === null ? null : step === canaryStep(row.state) ? row.step_started_at : now,
    t.to, iso, t.to, iso, t.to, iso, t.to, note ?? null,
    refallback ? now : row.fallback_at, ev.type === "rollback" ? now : row.rolled_back_at, row.n,
  );
  log("info", "transition", { incident: id, actor, event: ev.type, from: row.state, to: t.to });
  audit(db, row.n, actor, action, "ok", flags);
  return { status: 200, body: getIncident(db, id, now) };
}

// ---------- demo fault ----------

// Start or clear a provider outage through partner-mock's switch (CONTRACTS §3.2).
export async function fault(db: Database, b: any): Promise<Result> {
  if (b?.action !== "outage" && b?.action !== "clear") return err(400, "BAD_REQUEST", "action must be outage or clear");
  if (typeof b.provider !== "string" || !/^[a-z0-9-]+$/.test(b.provider)) return err(400, "BAD_REQUEST", "provider is required");
  const actor = typeof b.actor === "string" && b.actor.trim() ? b.actor : "operator";
  const what = `fault: ${b.action === "outage" ? "start outage on" : "clear outage on"} provider ${b.provider}`;
  try {
    if (!process.env.PARTNER_URL) throw new Error("PARTNER_URL is not set");
    const res = await fetch(`${process.env.PARTNER_URL}/admin/outage`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Admin-Secret": process.env.ADMIN_SECRET ?? "" },
      body: JSON.stringify({ provider: b.provider, status: b.action === "outage" ? 500 : null }),
      signal: AbortSignal.timeout(3000),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.outages || typeof j.outages !== "object") throw new Error(`partner-mock answered HTTP ${res.status}`);
    const outage = j.outages[b.provider] !== undefined && j.outages[b.provider] !== null;
    audit(db, null, actor, `${what}: outages now ${JSON.stringify(j.outages)}`, "ok");
    return { status: 200, body: { ok: true, provider: b.provider, outage } };
  } catch (e) {
    audit(db, null, actor, `${what} failed: ${(e as Error).message}`, "error");
    return err(502, "PARTNER_UNREACHABLE", (e as Error).message);
  }
}
