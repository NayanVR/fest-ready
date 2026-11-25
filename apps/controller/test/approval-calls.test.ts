import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { approvalCallTick } from "../src/approval-calls.ts";
import { openDb } from "../src/db.ts";
import { auditRows, recordProbe, serial, storeEvent, writePlaybook } from "../src/incidents.ts";
import { parseDuration, savePlaybook, validatePlaybook, type Playbook } from "../src/playbooks.ts";
import type { placeApprovalCall } from "../src/sarvam-voice.ts";

const seed = parse(readFileSync(join(import.meta.dir, "../playbooks/city-delivery-fallback.yaml"), "utf8")) as Playbook;
const contact = { phone_number: "+12025550101", delay_minutes: 1, language: "Hindi" } as const;
const start = 1_800_000_000_000;
const minute = 60_000;

function setup(db: ReturnType<typeof openDb>, state = "FINDINGS", autoAdvance = false) {
  const definition = { ...seed, approval_call: contact, recovery: { ...seed.recovery, auto_advance: autoAdvance } };
  const saved = savePlaybook(db, definition);
  if (!saved.ok) throw new Error(saved.reasons.join("\n"));
  const playbook = saved.playbook;
  const { n } = db.query<{ n: number }, [string, string, string, string, string, string]>(
    "INSERT INTO incidents (alert, state, playbook, value, playbook_snapshot, opened_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING n",
  ).get(playbook.match.alerts[0]!, state, playbook.id, playbook.dimension.values[0]!, JSON.stringify(playbook), new Date(start).toISOString())!;
  const calls: Parameters<typeof placeApprovalCall>[0][] = [];
  const send = async (call: Parameters<typeof placeApprovalCall>[0]) => {
    calls.push(call);
    return "fixture-attempt";
  };
  return { n, playbook, calls, send };
}

test("voice escalation requires an international number, language, and whole-minute delay", () => {
  expect(validatePlaybook({ ...seed, approval_call: contact })).toEqual([]);
  expect(validatePlaybook({ ...seed, approval_call: { phone_number: "local number", delay_minutes: 0, language: "invalid" } })).toEqual([
    "approval_call.phone_number must be a phone number in international format (E.164)",
    "approval_call.delay_minutes must be an integer from 1 to 1440",
    "approval_call.language must be a supported Sarvam voice language",
  ]);
});

test("calls only after fallback is actionable and records one attempt across a controller restart", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "approval-call-test-"));
  const path = join(tmp, "controller.db");
  let db = openDb(path);
  try {
    const { n, calls, send } = setup(db, "INVESTIGATING");
    await approvalCallTick(db, () => start, send);
    db.run("UPDATE incidents SET state = 'FINDINGS' WHERE n = ?", [n]);
    await approvalCallTick(db, () => start + minute, null); // integration unavailable, but the wait starts
    await approvalCallTick(db, () => start + 2 * minute - 1, send);
    expect(calls).toHaveLength(0);
    await Promise.all([approvalCallTick(db, () => start + 2 * minute, send), approvalCallTick(db, () => start + 2 * minute, send)]);
    db.close();
    db = openDb(path);
    await approvalCallTick(db, () => start + 3 * minute, send);
    expect(calls).toEqual([{
      phoneNumber: contact.phone_number, language: contact.language, incidentId: "INC-0001", action: "fallback",
    }]);
    expect(auditRows(db, "INC-0001")).toMatchObject([{ action: "approval call accepted (fallback)", result: "ok" }]);
    expect(JSON.stringify(auditRows(db, "INC-0001"))).not.toContain(contact.phone_number);
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("saved contact edits take effect while waiting and disabling resets an unclaimed timer", async () => {
  const db = openDb(":memory:");
  try {
    const { calls, send, playbook } = setup(db);
    const { approval_call: _contact, ...disabled } = playbook;
    await approvalCallTick(db, () => start, send);
    expect(writePlaybook(db, disabled, "operator", playbook.id).status).toBe(200);
    const next = { ...contact, phone_number: "+12025550102", language: "Gujarati" } as const;
    expect(writePlaybook(db, { ...playbook, approval_call: next }, "operator", playbook.id).status).toBe(200);
    await approvalCallTick(db, () => start + minute, send);
    expect(calls).toHaveLength(0);
    expect(writePlaybook(db, { ...playbook, approval_call: { ...next, language: "Tamil" } }, "operator", playbook.id).status).toBe(200);
    await approvalCallTick(db, () => start + 2 * minute, send);
    expect(calls).toMatchObject([{ phoneNumber: next.phone_number, language: "Tamil" }]);
    expect(writePlaybook(db, disabled, "operator", playbook.id).status).toBe(200);
    expect(writePlaybook(db, playbook, "operator", playbook.id).status).toBe(200);
    await approvalCallTick(db, () => start + 3 * minute, send);
    expect(calls).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("rechecks a queued approval and never retries an ambiguous call", async () => {
  const db = openDb(":memory:");
  try {
    const { n, calls, send } = setup(db);
    await approvalCallTick(db, () => start, send);
    const approve = serial(() => db.run("UPDATE incidents SET state = 'FALLBACK' WHERE n = ?", [n]));
    await Promise.all([approve, approvalCallTick(db, () => start + minute, send)]);
    expect(calls).toHaveLength(0);

    db.run("UPDATE incidents SET state = 'FINDINGS' WHERE n = ?", [n]);
    await approvalCallTick(db, () => start + minute, send);
    let attempted = 0;
    const fail = async () => {
      attempted++;
      await serial(() => {}); // sending cannot hold the same lock as an operator action
      throw new Error(`ambiguous outcome for ${contact.phone_number}`);
    };
    await approvalCallTick(db, () => start + 2 * minute, fail);
    await approvalCallTick(db, () => start + 3 * minute, fail);
    expect(attempted).toBe(1);
    expect(auditRows(db, "INC-0001")).toMatchObject([{ action: "approval call failed (fallback)", result: "error" }]);
    expect(JSON.stringify(auditRows(db, "INC-0001"))).not.toContain(contact.phone_number);
  } finally {
    db.close();
  }
});

test("waits for healthy probes and cooldown, then skips automatic or failing canary steps", async () => {
  const db = openDb(":memory:");
  try {
    const { n, calls, send, playbook } = setup(db, "PROBE_OK");
    db.run("UPDATE incidents SET fallback_at = ?, rolled_back_at = ? WHERE n = ?", [start, start, n]);
    recordProbe(db, n, true, 201, null, start);
    const eligible = start + Math.max(parseDuration(playbook.probe.healthy_for), parseDuration(playbook.recovery.cooldown_after_rollback));
    await approvalCallTick(db, () => eligible - 1, send);
    await approvalCallTick(db, () => eligible, send);
    expect(calls).toHaveLength(0);
    await approvalCallTick(db, () => eligible + minute, send);
    expect(calls.map((call) => call.action)).toEqual(["start_recovery"]);

    const recoveryTime = eligible + 2 * minute;
    const step = `CANARY_${playbook.recovery.steps[0]}`;
    db.run("UPDATE incidents SET state = ?, step_started_at = ? WHERE n = ?", [step, recoveryTime, n]);
    const { dimension_field, identity_field, outcome_field, canary_filter } = playbook.events;
    const event = (outcome: string, i: number) => ({
      ...canary_filter, [dimension_field]: playbook.dimension.values[0], [identity_field]: `fixture-${i}`, [outcome_field]: outcome,
    });
    const g = playbook.recovery.guardrail;
    const window = parseDuration(g.window);
    const ready = recoveryTime + window;
    for (let i = 0; i < g.min_samples; i++) storeEvent(db, event("success", i), recoveryTime);

    db.run("UPDATE incidents SET playbook_snapshot = ? WHERE n = ?", [
      JSON.stringify({ ...playbook, recovery: { ...playbook.recovery, auto_advance: true } }), n,
    ]);
    await approvalCallTick(db, () => ready, send);
    await approvalCallTick(db, () => ready + minute, send);
    expect(calls).toHaveLength(1);

    db.run("UPDATE incidents SET playbook_snapshot = ? WHERE n = ?", [JSON.stringify(playbook), n]);
    await approvalCallTick(db, () => ready + minute, send);
    for (let i = 0; i < g.max_consecutive_errors; i++) storeEvent(db, event("error", i), ready + minute + 1);
    await approvalCallTick(db, () => ready + 2 * minute, send);
    expect(calls).toHaveLength(1);

    // A new step after a rollback has its own pending approval and timer.
    const nextStart = ready + 3 * minute;
    db.run("UPDATE incidents SET state = 'FALLBACK', step_started_at = NULL WHERE n = ?", [n]);
    db.run("UPDATE incidents SET state = ?, step_started_at = ? WHERE n = ?", [step, nextStart, n]);
    for (let i = 0; i < g.min_samples; i++) storeEvent(db, event("success", i), nextStart);
    await approvalCallTick(db, () => nextStart + window, send);
    await approvalCallTick(db, () => nextStart + window + minute, send);
    expect(calls.map((call) => call.action)).toEqual(["start_recovery", "advance_recovery"]);
  } finally {
    db.close();
  }
});
