import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseDuration, type Playbook } from "../src/playbooks.ts";
import { canaryEvents, evaluateGuardrail, evidence, impact, probeStatus, toCsv, type Ev, type ProbeResult } from "../src/recovery.ts";

// Every threshold, duration and name comes from the seed playbook.
const SEED_DIR = join(import.meta.dir, "../playbooks");
const pb: Playbook = parse(readFileSync(join(SEED_DIR, readdirSync(SEED_DIR)[0]!), "utf8"));
const g = pb.recovery.guardrail;
const WINDOW = parseDuration(g.window);
const EVERY = parseDuration(pb.probe.every);
const HEALTHY_FOR = parseDuration(pb.probe.healthy_for);
const [V, OTHER] = pb.dimension.values as [string, string];
const F = pb.events;
const T0 = Date.parse("2026-11-25T10:00:00Z");

let n = 0;
type Opts = { value?: string; canary?: boolean; probe?: boolean; amount?: number; extra?: Record<string, unknown> };
const ev = (ts: number, outcome: string, o: Opts = {}): Ev => {
  const value = o.value ?? V;
  const filter = Object.fromEntries(Object.entries(F.canary_filter ?? {}).map(([k, v]) => [k, o.canary === false ? `not-${v}` : v]));
  return {
    ts,
    body: {
      [F.dimension_field]: value,
      [F.identity_field]: o.probe ? pb.probe.identities[value] : `cust-${++n}`,
      [F.outcome_field]: outcome,
      ...(F.amount_field ? { [F.amount_field]: o.amount ?? 100 } : {}),
      ...filter,
      ...o.extra,
    },
  };
};
// k events spaced 1 s apart starting at `from`.
const run = (from: number, k: number, outcome: string, o?: Opts) => Array.from({ length: k }, (_, i) => ev(from + i * 1000, outcome, o));

test("wait below min_samples", () => {
  const evs = run(T0, g.min_samples - 1, "success");
  const r = evaluateGuardrail(pb, V, evs, T0, T0 + WINDOW + 1000);
  expect(r.guardrail).toBe("wait");
  expect(r.advanceAllowed).toBe(false);
  expect(r.samples).toBe(g.min_samples - 1);
  expect(r.reason).toBe(`waiting for ${g.min_samples} samples (${g.min_samples - 1} so far)`);
});

test("wait until the observation window has passed, then pass", () => {
  const evs = run(T0, g.min_samples, "success");
  const early = evaluateGuardrail(pb, V, evs, T0, T0 + g.min_samples * 1000);
  if (g.min_samples * 1000 < WINDOW) {
    expect(early.guardrail).toBe("wait");
    expect(early.reason).toStartWith("observation window:");
  }
  const r = evaluateGuardrail(pb, V, evs, T0, T0 + WINDOW);
  expect(r).toMatchObject({ guardrail: "pass", advanceAllowed: true, reason: null, breach: null, errorRate: 0, samples: g.min_samples });
});

test("pass with a low error rate", () => {
  // one error among enough successes to stay at or under max_error_rate, error not at the tail
  const ok = Math.ceil(1 / g.max_error_rate);
  const evs = [ev(T0, "error"), ...run(T0 + 1000, ok, "success")];
  const r = evaluateGuardrail(pb, V, evs, T0, T0 + Math.max(WINDOW, (ok + 1) * 1000));
  expect(r.errorRate!).toBeLessThanOrEqual(g.max_error_rate);
  expect(r.guardrail).toBe("pass");
});

test("breach on consecutive errors even below min_samples", () => {
  const evs = run(T0, g.max_consecutive_errors, "error");
  expect(g.max_consecutive_errors).toBeLessThan(g.min_samples);
  const r = evaluateGuardrail(pb, V, evs, T0, T0 + 5000);
  expect(r.guardrail).toBe("breach");
  expect(r.consecutiveErrors).toBe(g.max_consecutive_errors);
  expect(r.advanceAllowed).toBe(false);
  // one fewer is only a wait
  expect(evaluateGuardrail(pb, V, evs.slice(1), T0, T0 + 5000).guardrail).toBe("wait");
});

test("breach on error rate over the trailing window", () => {
  // long clean history (whole-step rate stays low), then errors interleaved in the last window
  const old = run(T0, 200, "success");
  const tail: Ev[] = [];
  const start = T0 + 300_000;
  for (let i = 0; i < g.min_samples; i++) tail.push(ev(start + i * 1000, i % 2 ? "error" : "success"));
  const now = start + g.min_samples * 1000;
  const r = evaluateGuardrail(pb, V, [...old, ...tail], T0, now);
  expect(r.consecutiveErrors).toBeLessThan(g.max_consecutive_errors);
  expect(r.errorRate!).toBeLessThanOrEqual(g.max_error_rate);
  expect(r.guardrail).toBe("breach");
  expect(r.breach).toContain(g.window);
});

test("rejected outcomes are ignored", () => {
  const evs = [...run(T0, g.min_samples, "success"), ...run(T0 + 60_000, 50, "rejected")];
  const r = evaluateGuardrail(pb, V, evs, T0, T0 + 60_000 + WINDOW);
  expect(r.samples).toBe(g.min_samples);
  expect(r.guardrail).toBe("pass");
});

test("probes, other values, non-canary and pre-step events are excluded", () => {
  const before = run(T0 - 60_000, 20, "error");
  const probes = run(T0, 20, "error", { probe: true });
  const other = run(T0, 20, "error", { value: OTHER });
  const nonCanary = run(T0, 20, "error", { canary: false });
  const good = run(T0, g.min_samples, "success");
  const all = [...before, ...probes, ...other, ...nonCanary, ...good];
  expect(canaryEvents(pb, V, all, T0)).toHaveLength(g.min_samples);
  expect(evaluateGuardrail(pb, V, all, T0, T0 + WINDOW).guardrail).toBe("pass");
});

test("impact numbers", () => {
  const opened = T0, mitigated = T0 + 120_000, now = T0 + 300_000;
  const evs = [
    ev(T0 - 1000, "error", { amount: 9999 }), // before opened: ignored
    ev(T0 + 1000, "error", { amount: 1000, extra: { [F.identity_field]: "c1" } }),
    ev(T0 + 2000, "error", { amount: 2000, extra: { [F.identity_field]: "c1" } }),
    ev(T0 + 3000, "error", { amount: 3000, extra: { [F.identity_field]: "c2" } }),
    ev(T0 + 4000, "error", { probe: true, amount: 5000 }), // probe: ignored
    ev(T0 + 5000, "error", { value: OTHER, amount: 5000 }), // other value: ignored
    ev(T0 + 6000, "success", { canary: false, amount: 400 }), // safe path before mitigation: not saved
    ev(mitigated + 1000, "success", { canary: false, amount: 500 }),
    ev(mitigated + 2000, "success", { canary: false, amount: 700 }),
    ev(mitigated + 3000, "success", { amount: 900 }), // canary path: not "saved"
    ev(mitigated + 4000, "error", { amount: 600, extra: { [F.identity_field]: "c3" } }), // canary failure after mitigation
  ];
  expect(impact(pb, V, evs, opened, mitigated, now)).toEqual({
    ordersFailed: 4,
    amountFailed: F.amount_field ? 6600 : 0,
    ordersSaved: 2,
    amountSaved: F.amount_field ? 1200 : 0,
    atRiskPerMinute: F.amount_field ? 3000 : 0, // 6000 over 2 minutes
    customersAffected: 3,
  });
  // not mitigated yet: nothing saved, rate runs to now
  const open = impact(pb, V, evs.slice(0, 4), opened, null, T0 + 30_000);
  expect(open.ordersSaved).toBe(0);
  expect(open.atRiskPerMinute).toBe(F.amount_field ? 6000 : 0); // floor of one minute
});

test("evidence pack and CSV quoting", () => {
  const evs = [
    ev(T0 + 1000, "error", { extra: { note: 'says "hi", then\nleaves' } }),
    ev(T0 + 2000, "error", { extra: { nested: { a: 1 } } }),
    ev(T0 + 3000, "success"),
    ev(T0 + 4000, "error", { probe: true }),
  ];
  const e = evidence(pb, V, evs, T0, T0 + 10_000);
  expect(e).toMatchObject({ value: V, from: new Date(T0).toISOString(), to: new Date(T0 + 10_000).toISOString(), failedAttempts: 2, customersAffected: 2, byOutcome: { error: 2 } });
  expect(e.rows[0]).toEqual({ receivedAt: new Date(T0 + 1000).toISOString(), ...evs[0]!.body });

  const csv = toCsv(e.rows);
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe(["receivedAt", ...Object.keys(evs[0]!.body), "nested"].join(","));
  expect(csv).toContain('"says ""hi"", then\nleaves"');
  expect(csv).toContain('"{""a"":1}"');
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(toCsv([{ a: 1, b: null }, { c: "x,y" }])).toBe('a,b,c\r\n1,,\r\n,,"x,y"\r\n');
});

// 24 Nov bug: after an automatic rollback PROBE_OK came minutes late, because failures from before the rollback counted.
test("regression: probes healthy within healthy_for + one interval after a rollback", () => {
  const approve = T0;
  const rollback = T0 + 10 * EVERY + 1234;
  const results: ProbeResult[] = [];
  for (let t = approve + EVERY; t < rollback; t += EVERY) results.push({ ts: t, ok: false }); // provider down before rollback
  const firstOk = rollback + 500;
  const deadline = rollback + HEALTHY_FOR + EVERY;

  let healthyAt: number | null = null;
  for (let t = firstOk; t <= deadline + 5 * EVERY && healthyAt === null; t += EVERY) {
    results.push({ ts: t, ok: true });
    const s = probeStatus(pb, results, rollback, t);
    expect(s.healthySince).toBe(firstOk);
    if (s.healthy) healthyAt = t;
  }
  expect(healthyAt).not.toBeNull();
  expect(healthyAt!).toBeLessThanOrEqual(deadline);
  expect(healthyAt! - firstOk).toBeGreaterThanOrEqual(HEALTHY_FOR);
  expect(probeStatus(pb, results, rollback, healthyAt!).last.every(Boolean)).toBe(true);

  // even counted from approve, earlier failures never move healthySince
  expect(probeStatus(pb, results, approve, healthyAt!).healthySince).toBe(firstOk);

  // one failing probe resets healthySince; the next ok starts a fresh run
  const failAt = healthyAt! + EVERY;
  results.push({ ts: failAt, ok: false });
  const down = probeStatus(pb, results, rollback, failAt);
  expect(down).toMatchObject({ healthy: false, healthySince: null, healthyFor: pb.probe.healthy_for });
  expect(down.last.at(-1)).toBe(false);
  results.push({ ts: failAt + EVERY, ok: true });
  const back = probeStatus(pb, results, rollback, failAt + EVERY);
  expect(back).toMatchObject({ healthy: false, healthySince: failAt + EVERY });
  expect(back.last.slice(-2)).toEqual([false, true]);
  expect(back.last.length).toBeLessThanOrEqual(10);
});
