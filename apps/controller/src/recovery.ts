// Pure recovery logic (B5): guardrail, probe health, impact, evidence pack.
// No DB, no fetch, no clock: callers pass time in ms. Every field name comes from the playbook's `events` block.
import { isProbe, parseDuration, type Playbook } from "./playbooks.ts";

export type Ev = { ts: number; body: Record<string, unknown> };
export type ProbeResult = { ts: number; ok: boolean };

const ERROR = "error";
const SUCCESS = "success";

const byTs = <T extends { ts: number }>(a: T[]) => [...a].sort((x, y) => x.ts - y.ts);
const iso = (ms: number) => new Date(ms).toISOString();
const outcome = (pb: Playbook, e: Ev) => e.body[pb.events.outcome_field];
const amount = (pb: Playbook, e: Ev) => (pb.events.amount_field ? Number(e.body[pb.events.amount_field]) || 0 : 0);
const sum = (pb: Playbook, es: Ev[]) => es.reduce((s, e) => s + amount(pb, e), 0);
const distinct = (pb: Playbook, es: Ev[]) => new Set(es.map((e) => e.body[pb.events.identity_field])).size;
const matchesFilter = (pb: Playbook, e: Ev) =>
  Object.entries(pb.events.canary_filter ?? {}).every(([k, v]) => e.body[k] === v);
// Real (non-probe) events for one value.
const forValue = (pb: Playbook, value: string, events: Ev[]) =>
  events.filter((e) => e.body[pb.events.dimension_field] === value && !isProbe(pb, e.body));

export function canaryEvents(pb: Playbook, value: string, events: Ev[], sinceMs: number): Ev[] {
  return byTs(forValue(pb, value, events).filter((e) => e.ts >= sinceMs && matchesFilter(pb, e)));
}

export type Guardrail = {
  samples: number; minSamples: number; errorRate: number | null; maxErrorRate: number;
  consecutiveErrors: number; guardrail: "pass" | "wait" | "breach"; advanceAllowed: boolean;
  reason: string | null; breach: string | null;
};

export function evaluateGuardrail(pb: Playbook, value: string, events: Ev[], stepStartedMs: number, now: number): Guardrail {
  const g = pb.recovery.guardrail;
  const windowMs = parseDuration(g.window);
  // Only success/error count; anything else (e.g. rejected) is ignored.
  const counted = canaryEvents(pb, value, events, stepStartedMs).filter((e) => e.ts <= now && [ERROR, SUCCESS].includes(outcome(pb, e) as string));
  const isErr = (e: Ev) => outcome(pb, e) === ERROR;
  const rate = (es: Ev[]) => (es.length ? es.filter(isErr).length / es.length : null);

  const samples = counted.length;
  const errorRate = rate(counted);
  const windowRate = rate(counted.filter((e) => e.ts >= now - windowMs));
  let consecutiveErrors = 0;
  for (let i = counted.length - 1; i >= 0 && isErr(counted[i]!); i--) consecutiveErrors++;

  let breach: string | null = null;
  if (consecutiveErrors >= g.max_consecutive_errors) breach = `${consecutiveErrors} errors in a row (limit ${g.max_consecutive_errors})`;
  else if (samples >= g.min_samples && windowRate !== null && windowRate > g.max_error_rate)
    breach = `error rate ${pct(windowRate)} over the last ${g.window} > ${pct(g.max_error_rate)}`;
  else if (samples >= g.min_samples && errorRate! > g.max_error_rate)
    breach = `error rate ${pct(errorRate!)} this step > ${pct(g.max_error_rate)}`;

  const left = stepStartedMs + windowMs - now;
  const reason = breach ? `guardrail breached: ${breach}`
    : samples < g.min_samples ? `waiting for ${g.min_samples} samples (${samples} so far)`
    : left > 0 ? `observation window: ${Math.ceil(left / 1000)}s left`
    : null;

  return {
    samples, minSamples: g.min_samples, errorRate, maxErrorRate: g.max_error_rate, consecutiveErrors,
    guardrail: breach ? "breach" : reason ? "wait" : "pass",
    advanceAllowed: !breach && !reason, reason, breach,
  };
}

const pct = (x: number) => `${+(x * 100).toFixed(1)}%`;

export function probeStatus(pb: Playbook, results: ProbeResult[], sinceMs: number, now: number):
  { healthy: boolean; healthySince: number | null; healthyFor: string; last: boolean[] } {
  const rs = byTs(results.filter((r) => r.ts >= sinceMs && r.ts <= now));
  let healthySince: number | null = null;
  for (let i = rs.length - 1; i >= 0 && rs[i]!.ok; i--) healthySince = rs[i]!.ts;
  return {
    healthy: healthySince !== null && now - healthySince >= parseDuration(pb.probe.healthy_for),
    healthySince,
    healthyFor: pb.probe.healthy_for,
    last: rs.slice(-10).map((r) => r.ok),
  };
}

export function impact(pb: Playbook, value: string, events: Ev[], openedMs: number, mitigatedMs: number | null, now: number) {
  const es = forValue(pb, value, events).filter((e) => e.ts >= openedMs && e.ts <= now);
  const failed = es.filter((e) => outcome(pb, e) === ERROR);
  const saved = mitigatedMs === null ? []
    : es.filter((e) => e.ts >= mitigatedMs && outcome(pb, e) === SUCCESS && !matchesFilter(pb, e));
  const end = mitigatedMs ?? now;
  const atRisk = failed.filter((e) => e.ts <= end);
  // ponytail: at least one minute in the denominator so a just-opened incident doesn't inflate the per-minute figure.
  // Measured from the first failure, so the lookback before the alert doesn't dilute it.
  const firstFail = atRisk.reduce((m, e) => Math.min(m, e.ts), end);
  const minutes = Math.max(end - firstFail, 60_000) / 60_000;
  return {
    ordersFailed: failed.length,
    amountFailed: sum(pb, failed),
    ordersSaved: saved.length,
    amountSaved: sum(pb, saved),
    atRiskPerMinute: Math.round(sum(pb, atRisk) / minutes),
    customersAffected: distinct(pb, failed),
  };
}

export function evidence(pb: Playbook, value: string, events: Ev[], openedMs: number, now: number) {
  const failed = byTs(forValue(pb, value, events).filter((e) => e.ts >= openedMs && e.ts <= now && outcome(pb, e) === ERROR));
  const byOutcome: Record<string, number> = {};
  for (const e of failed) byOutcome[String(outcome(pb, e))] = (byOutcome[String(outcome(pb, e))] ?? 0) + 1;
  return {
    value,
    from: iso(openedMs),
    to: iso(now),
    failedAttempts: failed.length,
    customersAffected: distinct(pb, failed),
    byOutcome,
    rows: failed.map((e) => ({ receivedAt: iso(e.ts), ...e.body })) as Record<string, unknown>[],
  };
}

// RFC 4180: CRLF line ends, fields with , " CR or LF are quoted and " doubled. Objects become JSON, null/undefined empty.
export function toCsv(rows: Record<string, unknown>[]): string {
  const header: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!header.includes(k)) header.push(k);
  const cell = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [header, ...rows.map((r) => header.map((k) => r[k]))].map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
