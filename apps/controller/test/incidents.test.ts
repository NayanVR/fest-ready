// State machine, findings validation and the incident flow with Flagsmith stubbed. Values come from the seed playbook.
import { expect, mock, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

// Flagsmith stub: remembers the state like the real one would read back.
let flag = { fallbackActive: false, fallbackEnabled: true, fallbackValue: null as string | null, splitPercent: 0 };
mock.module("../src/flagsmith.ts", () => ({
  warm: async () => {},
  apply: async (pb: any, _v: string, change: { fallback?: boolean; split?: number }) => {
    const before = { ...flag };
    if (change.fallback !== undefined) {
      const s = change.fallback ? pb.flag.fallback : pb.flag.normal;
      flag = { ...flag, fallbackActive: change.fallback, fallbackEnabled: s.enabled };
    }
    if (change.split !== undefined) flag = { ...flag, splitPercent: change.split };
    return { before, readBack: { ...flag } };
  },
  findFeatureId: async () => 1,
  findSegmentId: async () => 1,
}));

const { openDb } = await import("../src/db.ts");
const { seedPlaybooks, parseDuration } = await import("../src/playbooks.ts");
const { act, auditRows, findingsForIncident, findingsFromNubi, getIncident, onAlert, storeEvent, recordProbe } = await import("../src/incidents.ts");
const { transition, statusOf } = await import("../src/machine.ts");
const { guardrailTick, probeTick } = await import("../src/loops.ts");

const SEED_DIR = join(import.meta.dir, "../playbooks");
const pb = parse(readFileSync(join(SEED_DIR, readdirSync(SEED_DIR)[0]!), "utf8"));
const [V] = pb.dimension.values;
const ALERT = pb.match.alerts[0];
const steps: number[] = pb.recovery.steps;
const g = pb.recovery.guardrail;
const E = pb.events;

function freshDb() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "inc-")), "c.db"));
  seedPlaybooks(db, SEED_DIR);
  flag = { fallbackActive: false, fallbackEnabled: true, fallbackValue: null, splitPercent: 0 };
  return db;
}
const fire = (db: any) => onAlert(db, { version: "4", status: "firing", alerts: [{ status: "firing", labels: { alertname: ALERT } }] });
const findings = (extra: object = {}) => ({ playbook: pb.id, value: V, cause: pb.match.cause, summary: "test findings", ...extra });
const order = (outcome: string, i: number) => ({
  ...pb.events.canary_filter, [E.dimension_field]: V, [E.identity_field]: `id-${i}`, [E.outcome_field]: outcome,
  ...(E.amount_field ? { [E.amount_field]: 100 } : {}),
});

test("state machine: approve needs findings, advance is gated, rollback goes to fallback", () => {
  expect(transition("INVESTIGATING", { type: "approve" }, steps)).toMatchObject({ error: "NO_FINDINGS" });
  expect(transition("FINDINGS", { type: "approve" }, steps)).toEqual({ to: "FALLBACK", fallback: true, split: 0 });
  expect(transition("FALLBACK", { type: "advance", guardrailPass: true, cooldownLeftMs: 0 }, steps)).toMatchObject({ error: "PROBE_NOT_HEALTHY" });
  expect(transition("PROBE_OK", { type: "advance", guardrailPass: false, cooldownLeftMs: 1000 }, steps)).toMatchObject({ error: "COOLDOWN_ACTIVE" });
  expect(transition("PROBE_OK", { type: "advance", guardrailPass: false, cooldownLeftMs: 0 }, steps)).toEqual({ to: `CANARY_${steps[0]}`, split: steps[0] });
  expect(transition(`CANARY_${steps[0]}`, { type: "advance", guardrailPass: false, cooldownLeftMs: 0 }, steps)).toMatchObject({ error: "GUARDRAIL_NOT_PASSED" });
  expect(transition(`CANARY_${steps[0]}`, { type: "advance", guardrailPass: true, cooldownLeftMs: 0 }, steps)).toEqual({ to: `CANARY_${steps[1]}`, split: steps[1] });
  expect(transition(`CANARY_${steps.at(-1)}`, { type: "advance", guardrailPass: true, cooldownLeftMs: 0 }, steps)).toEqual({ to: "NORMAL", fallback: false, split: 0 });
  expect(transition(`CANARY_${steps[1]}`, { type: "rollback" }, steps)).toEqual({ to: "FALLBACK", split: 0 });
  expect(transition("FALLBACK", { type: "close" }, steps)).toMatchObject({ error: "INVALID_STATE" });
  expect(["INVESTIGATING", "FINDINGS", "MANUAL"].map(statusOf)).toEqual(["Investigating", "Investigating", "Investigating"]);
  expect(statusOf("PROBE_OK")).toBe("Mitigated");
});

test("findings validation in contract order; summary stored byte-for-byte", async () => {
  const db = freshDb();
  expect(findingsFromNubi(db, findings())).toMatchObject({ accepted: false, error: "NO_OPEN_INCIDENT" });
  await fire(db);
  await fire(db); // deduplicated
  const id = "INC-0001";
  expect(findingsFromNubi(db, findings({ playbook: "nope" }))).toMatchObject({ accepted: false, error: "UNKNOWN_PLAYBOOK" });
  expect(findingsFromNubi(db, findings({ value: "not-a-value" }))).toMatchObject({ accepted: false, error: "VALUE_NOT_ALLOWED" });
  expect(findingsFromNubi(db, findings({ cause: pb.match.cause === "external" ? "internal" : "external" }))).toMatchObject({ error: "CAUSE_MISMATCH" });
  expect(getIncident(db, id)!.findings).toBeNull();
  expect((await act(db, id, "op", { type: "approve" })).status).toBe(409);
  const summary = 'Line one — "quoted" ✓\nline two\t<b>raw</b>';
  expect(findingsFromNubi(db, findings({ summary }))).toEqual({ accepted: true, incident: id });
  const inc = getIncident(db, id)!;
  expect(inc.findings.summary).toBe(summary);
  expect(inc.findings.source).toBe("nubi");
  expect(inc.status).toBe("Investigating");
  expect(inc.value).toBe(V);
  expect(findingsForIncident(db, "INC-0099", findings()).status).toBe(404);
});

test("flow: approve → probe → advance gated → automatic rollback → cooldown → probe ok again", async () => {
  const db = freshDb();
  await fire(db);
  const id = "INC-0001";
  findingsForIncident(db, id, findings());
  let r: any = await act(db, id, "op", { type: "approve" });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe("Mitigated");
  expect(flag.fallbackActive).toBe(true);

  // Probe loop with a fake clock and fake probe: healthy for healthy_for → PROBE_OK.
  let now = Date.now();
  const ok = async () => ({ ok: true, status: 201, error: null });
  const every = parseDuration(pb.probe.every), healthyFor = parseDuration(pb.probe.healthy_for);
  const start = now;
  while (getIncident(db, id)!.recovery!.state === "FALLBACK" && now - start < healthyFor + 3 * every) {
    await probeTick(db, ok, () => now);
    now += 1000;
  }
  expect(getIncident(db, id)!.recovery!.state).toBe("PROBE_OK");
  expect(now - start).toBeLessThanOrEqual(healthyFor + every + 1000);

  r = await act(db, id, "op", { type: "advance", guardrailPass: false, cooldownLeftMs: 0 });
  expect(r.body.recovery.state).toBe(`CANARY_${steps[0]}`);
  expect(flag.splitPercent).toBe(steps[0]);
  // Not enough samples yet.
  r = await act(db, id, "op", { type: "advance", guardrailPass: false, cooldownLeftMs: 0 });
  expect(r.body.error).toBe("GUARDRAIL_NOT_PASSED");

  // Consecutive errors → automatic rollback by the guardrail loop.
  for (let i = 0; i < g.max_consecutive_errors; i++) storeEvent(db, order("error", i));
  await guardrailTick(db);
  const inc = getIncident(db, id)!;
  expect(inc.recovery!.state).toBe("FALLBACK");
  expect(flag.splitPercent).toBe(0);
  const rb = auditRows(db, id)[0];
  expect(rb.actor).toBe("controller");
  expect(rb.readBack.splitPercent).toBe(0);

  // Cooldown: probes healthy again, but advance from PROBE_OK is refused until cooldown ends.
  recordProbe(db, 1, true, 201, null, Date.now());
  now = Date.now() + healthyFor;
  await probeTick(db, ok, () => now);
  expect(getIncident(db, id)!.recovery!.state).toBe("PROBE_OK");
  r = await act(db, id, "op", { type: "advance", guardrailPass: false, cooldownLeftMs: 0 });
  if (parseDuration(pb.recovery.cooldown_after_rollback) > 0) expect(r.body.error).toBe("COOLDOWN_ACTIVE");

  // Alert re-fire during a canary step takes the rollback path.
  r = await act(db, id, "op", { type: "advance", guardrailPass: false, cooldownLeftMs: 0 }, undefined, Date.now() + parseDuration(pb.recovery.cooldown_after_rollback));
  expect(r.body.recovery.state).toBe(`CANARY_${steps[0]}`);
  await fire(db);
  expect(getIncident(db, id)!.recovery!.state).toBe("FALLBACK");
  expect(auditRows(db, id)[0].actor).toBe("alertmanager");
});

test("close needs Resolved or Investigating; impact counts this value", async () => {
  const db = freshDb();
  await fire(db);
  for (let i = 0; i < 5; i++) storeEvent(db, order("error", i));
  findingsForIncident(db, "INC-0001", findings());
  const inc = getIncident(db, "INC-0001")!;
  expect(inc.impact!.ordersFailed).toBe(5);
  expect(inc.impact!.customersAffected).toBe(5);
  await act(db, "INC-0001", "op", { type: "approve" });
  expect((await act(db, "INC-0001", "op", { type: "close" }, "done")).status).toBe(409);
});
