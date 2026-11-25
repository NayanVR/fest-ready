// Playbook schema, validation, templating and SQLite storage (CONTRACTS.md §8).
// No business names here: everything comes from the playbook itself.
import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type FlagState = { enabled: boolean; value?: string | number };
export type Playbook = {
  id: string;
  version: number;
  owner: string;
  description: string;
  match: { alerts: string[]; cause: "external" | "internal" };
  dimension: { name: string; trait: string; label: string; values: string[] };
  flag: { key: string; normal: FlagState; fallback: FlagState };
  segments: { fallback: string; recovery: string };
  recovery: {
    method: "split" | "segments";
    steps: number[];
    guardrail: { min_samples: number; max_error_rate: number; max_consecutive_errors: number; window: string };
    cooldown_after_rollback: string;
  };
  events: {
    dimension_field: string;
    identity_field: string;
    outcome_field: string;
    amount_field?: string;
    canary_filter?: Record<string, unknown>;
  };
  health?: { errors: string; total: string };
  probe: {
    every: string;
    healthy_for: string;
    identities: Record<string, string>;
    request: { method: string; url: string; body?: unknown };
    expect: { healthy: { status: number }; fallback_active: { status: number } };
  };
};

const DURATION = /^(\d+)(ms|s|m|h)$/;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

export function parseDuration(d: string): number {
  const m = DURATION.exec(d);
  if (!m) throw new Error(`bad duration: ${d}`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

// {value}, {probe_identity}, ${ENV_VAR}. Identifier-only braces, so PromQL label sets like {label="..."} are ignored.
const PLACEHOLDER = /(\$?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function validatePlaybook(p: any): string[] {
  const r: string[] = [];
  const isObj = (x: unknown) => x !== null && typeof x === "object" && !Array.isArray(x);
  const str = (x: unknown) => typeof x === "string" && x.trim() !== "";
  const int = (x: unknown) => Number.isInteger(x);
  const strArr = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every(str);
  const dur = (x: unknown) => typeof x === "string" && DURATION.test(x);
  const get = (path: string) => path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), p);
  const need = (path: string, ok: (x: any) => boolean, what: string) => {
    if (!ok(get(path))) r.push(`${path} must be ${what}`);
  };
  const flagState = (x: any) =>
    isObj(x) && typeof x.enabled === "boolean" && (x.value === undefined || typeof x.value === "string" || typeof x.value === "number");

  if (!isObj(p)) return ["playbook must be an object"];

  need("id", (x) => typeof x === "string" && /^[a-z0-9-]+$/.test(x), "a string matching ^[a-z0-9-]+$");
  need("owner", str, "a non-empty string");
  need("description", str, "a non-empty string");
  need("match.alerts", strArr, "a non-empty string array");
  need("match.cause", (x) => x === "external" || x === "internal", "external or internal");
  for (const k of ["name", "trait", "label"]) need(`dimension.${k}`, str, "a non-empty string");
  need("dimension.values", (x) => strArr(x) && new Set(x).size === x.length, "a non-empty array of unique strings");
  need("flag.key", str, "a non-empty string");
  need("flag.normal", flagState, "{enabled: bool, value?: string|number}");
  need("flag.fallback", flagState, "{enabled: bool, value?: string|number}");
  if (flagState(p.flag?.normal) && flagState(p.flag?.fallback) &&
      p.flag.normal.enabled === p.flag.fallback.enabled && p.flag.normal.value === p.flag.fallback.value)
    r.push("flag.normal and flag.fallback must differ");
  need("segments.fallback", (x) => str(x) && x.includes("{value}"), "a string containing {value}");
  need("segments.recovery", (x) => str(x) && x.includes("{value}"), "a string containing {value}");
  if (str(p.segments?.fallback) && p.segments.fallback === p.segments?.recovery)
    r.push("segments.fallback and segments.recovery must differ");

  need("recovery.method", (x) => x === "split" || x === "segments", "split or segments");
  need(
    "recovery.steps",
    (s) => Array.isArray(s) && s.length > 0 && s.every((n) => int(n) && n > 0) &&
      s.every((n, i) => i === 0 || n > s[i - 1]) && s[0] <= 10 && s[s.length - 1] === 100,
    "strictly increasing positive integers, first ≤ 10, last = 100",
  );
  need("recovery.guardrail.min_samples", (x) => int(x) && x >= 10, "an integer ≥ 10");
  need("recovery.guardrail.max_error_rate", (x) => typeof x === "number" && x > 0 && x <= 0.2, "a number with 0 < x ≤ 0.2");
  need("recovery.guardrail.max_consecutive_errors", (x) => int(x) && x >= 1, "an integer ≥ 1");
  need("recovery.guardrail.window", dur, "a duration like 60s");
  need("recovery.cooldown_after_rollback", dur, "a duration like 120s");

  for (const k of ["dimension_field", "identity_field", "outcome_field"]) need(`events.${k}`, str, "a non-empty string");
  need("events.amount_field", (x) => x === undefined || str(x), "a non-empty string if set");
  need("events.canary_filter", (x) => x === undefined || isObj(x), "an object if set");

  if (p.health !== undefined) {
    need("health.errors", str, "a PromQL string");
    need("health.total", str, "a PromQL string");
  }

  need("probe.every", dur, "a duration like 30s");
  need("probe.healthy_for", dur, "a duration like 5m");
  need("probe.identities", isObj, "a map of value → identity");
  if (isObj(p.probe?.identities) && strArr(p.dimension?.values)) {
    for (const v of p.dimension.values)
      if (!str(p.probe.identities[v])) r.push(`probe.identities is missing ${v}`);
    for (const k of Object.keys(p.probe.identities))
      if (!p.dimension.values.includes(k)) r.push(`probe.identities has ${k}, which is not in dimension.values`);
  }
  need("probe.request.method", str, "an HTTP method");
  need("probe.request.url", str, "a URL");
  need("probe.expect.healthy.status", int, "an integer HTTP status");
  need("probe.expect.fallback_active.status", int, "an integer HTTP status");

  // Only {value}, {probe_identity} and ${ENV_VAR} placeholders are allowed anywhere.
  const scan = (x: unknown, path: string): void => {
    if (typeof x === "string") {
      for (const [, dollar, name] of x.matchAll(PLACEHOLDER))
        if (!dollar && name !== "value" && name !== "probe_identity") r.push(`${path}: unknown placeholder {${name}}`);
    } else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) scan(v, path ? `${path}.${k}` : k);
    }
  };
  scan(p, "");
  return r;
}

// Replaces {value}, {probe_identity} and ${ENV} in every string of x. Single pass: substituted text is never re-expanded.
export function render<T>(x: T, vars: { value?: string; probe_identity?: string }, env: Record<string, string | undefined> = process.env): T {
  if (typeof x === "string")
    return x.replace(PLACEHOLDER, (m, dollar, name) => {
      const v = dollar ? env[name] : (vars as Record<string, string | undefined>)[name];
      if (v === undefined) throw new Error(`no value for placeholder ${m}`);
      return v;
    }) as T;
  if (Array.isArray(x)) return x.map((e) => render(e, vars, env)) as T;
  if (x && typeof x === "object")
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, render(v, vars, env)])) as T;
  return x;
}

// Probe orders are recognised by the playbook's probe identities (never by a `synthetic` field).
export const isProbe = (pb: Playbook, body: Record<string, unknown>) =>
  Object.values(pb.probe.identities).includes(body[pb.events.identity_field] as string);

// ---- storage ----

export function listPlaybooks(db: Database): Playbook[] {
  return db.query<{ body: string }, []>("SELECT body FROM playbooks ORDER BY id").all().map((r) => JSON.parse(r.body));
}

export function getPlaybook(db: Database, id: string): Playbook | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM playbooks WHERE id = ?").get(id);
  return row ? JSON.parse(row.body) : null;
}

// Insert (version 1) or update (version + 1). Input version is ignored; the controller owns it.
export function savePlaybook(db: Database, input: any): { ok: true; playbook: Playbook } | { ok: false; reasons: string[] } {
  const reasons = validatePlaybook(input);
  if (reasons.length) return { ok: false, reasons };
  const prev = getPlaybook(db, input.id);
  return { ok: true, playbook: persistPlaybook(db, input, (prev?.version ?? 0) + 1) };
}

export function persistPlaybook(db: Database, input: Omit<Playbook, "version">, version: number): Playbook {
  const playbook: Playbook = { ...input, version };
  db.query(`INSERT INTO playbooks (id, version, body, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, body = excluded.body, updated_at = excluded.updated_at`).run(
    playbook.id, playbook.version, JSON.stringify(playbook), new Date().toISOString(),
  );
  return playbook;
}

// API-managed probes can call only the configured shop order endpoint. Network-bound
// templates must not expand credentials from the controller environment.
export function validateWritablePlaybook(input: unknown): string[] {
  const reasons = validatePlaybook(input);
  if (reasons.length) return reasons;
  const pb = input as Playbook;
  if (pb.recovery.method !== "split") reasons.push("recovery.method must be split");
  if (pb.probe.request.method !== "POST" || pb.probe.request.url !== "${SHOP_URL}/api/orders")
    reasons.push("probe.request must POST to ${SHOP_URL}/api/orders");
  const envPlaceholder = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
  if (envPlaceholder.test(JSON.stringify(pb.probe.request.body) ?? ""))
    reasons.push("probe.request.body must not contain environment placeholders");
  if ([pb.segments.fallback, pb.segments.recovery].some((name) => envPlaceholder.test(name)))
    reasons.push("segment templates must not contain environment placeholders");
  return reasons;
}

// Imports PLAYBOOK_DIR/*.yaml only when the table is empty. An invalid seed is a startup error.
export function seedPlaybooks(db: Database, dir = process.env.PLAYBOOK_DIR || "./playbooks"): number {
  const { n } = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM playbooks").get()!;
  if (n > 0) return 0;
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  db.transaction(() => {
    for (const f of files) {
      const res = savePlaybook(db, parse(readFileSync(join(dir, f), "utf8")));
      if (!res.ok) throw new Error(`seed ${f} is invalid: ${res.reasons.join("; ")}`);
    }
  })();
  return files.length;
}
