import type { Database } from "bun:sqlite";
import { auditApprovalCall, incidentId, incidentPlaybook, probeResults, serial, stepGuardrail, type IncidentRow } from "./incidents.ts";
import { canaryStep, cooldownLeftMs } from "./machine.ts";
import { getPlaybook, type Playbook } from "./playbooks.ts";
import { probeStatus } from "./recovery.ts";
import { placeApprovalCall, sarvamVoiceConfigured } from "./sarvam-voice.ts";

type Call = Parameters<typeof placeApprovalCall>[0];

function pendingApproval(db: Database, row: IncidentRow, playbook: Playbook, now: number): Call["action"] | undefined {
  if (!row.value || !playbook.dimension.values.includes(row.value)) return;
  if (row.state === "FINDINGS") return "fallback";
  if (row.state === "PROBE_OK" && row.fallback_at !== null && cooldownLeftMs(playbook, row.rolled_back_at, now) === 0) {
    const probes = probeResults(db, row.n, row.fallback_at);
    if (probeStatus(playbook, probes, row.fallback_at, now).healthy) return "start_recovery";
  }
  if (canaryStep(row.state) !== null && row.step_started_at !== null && playbook.recovery.auto_advance !== true &&
      stepGuardrail(db, row, playbook, now).advanceAllowed) return "advance_recovery";
}

export async function approvalCallTick(
  db: Database,
  clock = Date.now,
  send: typeof placeApprovalCall | null = sarvamVoiceConfigured() ? placeApprovalCall : null,
) {
  const candidates = db.query<{ n: number }, []>(`SELECT i.n FROM incidents i JOIN playbooks p ON p.id = i.playbook
    WHERE json_type(p.body, '$.approval_call') = 'object'
      AND (i.state IN ('FINDINGS', 'PROBE_OK') OR i.step_started_at IS NOT NULL)`).all();

  for (const { n } of candidates) {
    const call = await serial(() => db.transaction((): Call | null => {
      // Read again under the same lock as approvals and state changes so a queued action can cancel the call.
      const now = clock();
      const row = db.query<IncidentRow, [number]>("SELECT * FROM incidents WHERE n = ?").get(n);
      const snapshot = row && incidentPlaybook(row);
      const action = row && snapshot && pendingApproval(db, row, snapshot, now);
      if (!row || !action) {
        db.run("DELETE FROM approval_call_waits WHERE incident = ?", [n]);
        return null;
      }

      // An operator can turn off or change contact settings on an open incident. The original playbook still controls recovery.
      const config = row.playbook && getPlaybook(db, row.playbook)?.approval_call;
      if (!config) {
        db.run("DELETE FROM approval_call_waits WHERE incident = ? AND claimed = 0", [n]);
        return null;
      }
      db.run(`INSERT INTO approval_call_waits (incident, pending_since) VALUES (?, ?)
        ON CONFLICT(incident) DO NOTHING`, [n, now]);
      if (!send) return null;

      // Persist the claim before the request. A crash or timeout may still have placed the call, so do not retry.
      const claimed = db.query(`UPDATE approval_call_waits SET claimed = 1
        WHERE incident = ? AND claimed = 0 AND pending_since <= ? RETURNING incident`).get(n, now - config.delay_minutes * 60_000);
      if (!claimed) return null;
      return { phoneNumber: config.phone_number, language: config.language, incidentId: incidentId(n), alert: row.alert, action };
    }).immediate());

    if (!call || !send) continue;
    let accepted = false;
    try {
      await send(call);
      accepted = true;
    } catch {
      // Upstream error bodies may contain the recipient or credentials. The audit stores only the outcome.
    }
    await serial(() => auditApprovalCall(db, n, call.action, accepted));
  }
}
