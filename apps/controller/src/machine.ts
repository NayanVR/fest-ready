// Pure pieces of the incident engine: the recovery state machine (ARCHITECTURE §9.1), ticket status (§9.4)
// and findings validation (CONTRACTS §3.5, shared by the operator form and MCP). No business names.
import { parseDuration, type Playbook } from "./playbooks.ts";

export type Event =
  | { type: "findings"; manual: boolean }
  | { type: "approve" }
  | { type: "probe"; healthy: boolean }
  | { type: "advance"; guardrailPass: boolean; cooldownLeftMs: number }
  | { type: "rollback" }
  | { type: "close" };

// `fallback`/`split` are the Flagsmith changes the transition needs; the caller applies them before saving `to`.
export type Transition = { to: string; fallback?: boolean; split?: number } | { error: string; message: string };

export const INVESTIGATING = ["INVESTIGATING", "FINDINGS", "MANUAL"];
export const canaryStep = (state: string) => (state.startsWith("CANARY_") ? Number(state.slice(7)) : null);

export function statusOf(state: string): string {
  if (INVESTIGATING.includes(state)) return "Investigating";
  if (state === "FALLBACK" || state === "PROBE_OK") return "Mitigated";
  if (canaryStep(state) !== null) return "Recovering";
  return state === "NORMAL" ? "Resolved" : "Closed";
}

export function transition(state: string, ev: Event, steps: number[]): Transition {
  const bad = (error: string, message: string) => ({ error, message });
  const step = canaryStep(state);
  switch (ev.type) {
    case "findings":
      if (!INVESTIGATING.includes(state)) return bad("NO_OPEN_INCIDENT", `incident is ${statusOf(state)}, not Investigating`);
      return { to: ev.manual ? "MANUAL" : "FINDINGS" };
    case "approve":
      if (state === "FINDINGS") return { to: "FALLBACK", fallback: true, split: 0 };
      if (INVESTIGATING.includes(state)) return bad("NO_FINDINGS", "no valid findings with a playbook yet");
      return bad("INVALID_STATE", `cannot approve in ${state}`);
    case "probe":
      if (ev.healthy && state === "FALLBACK") return { to: "PROBE_OK" };
      if (!ev.healthy && state === "PROBE_OK") return { to: "FALLBACK" };
      return { to: state };
    case "advance": {
      if ((state === "PROBE_OK" || state === "FALLBACK") && ev.cooldownLeftMs > 0)
        return bad("COOLDOWN_ACTIVE", `cooldown after rollback: ${Math.ceil(ev.cooldownLeftMs / 1000)}s left`);
      if (state === "PROBE_OK") return { to: `CANARY_${steps[0]}`, split: steps[0] };
      if (state === "FALLBACK") return bad("PROBE_NOT_HEALTHY", "the provider probe is not healthy yet");
      if (step === null) return bad("INVALID_STATE", `cannot advance in ${state}`);
      if (!ev.guardrailPass) return bad("GUARDRAIL_NOT_PASSED", "minimum sample, observation window or error rate not met");
      const next = steps.find((s) => s > step);
      return next === undefined ? { to: "NORMAL", fallback: false, split: 0 } : { to: `CANARY_${next}`, split: next };
    }
    case "rollback":
      if (step === null) return bad("INVALID_STATE", `nothing to roll back in ${state}`);
      return { to: "FALLBACK", split: 0 };
    case "close":
      if (state === "NORMAL" || INVESTIGATING.includes(state)) return { to: "CLOSED" };
      return bad("INVALID_STATE", `cannot close while ${statusOf(state)}; recover to 100% first`);
  }
}

export const cooldownLeftMs = (pb: Playbook, rolledBackAt: number | null, now: number) =>
  rolledBackAt === null ? 0 : Math.max(0, rolledBackAt + parseDuration(pb.recovery.cooldown_after_rollback) - now);

export type Findings = {
  playbook: string | null; value: string | null; cause: "external" | "internal";
  summary: string; evidence: string[]; nubiUrl: string | null;
};

// Shape check. Returns the findings or an error message. `summary` is passed through untouched (stored verbatim).
export function parseFindings(b: any): Findings | string {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "body must be an object";
  if (b.playbook !== null && typeof b.playbook !== "string") return "playbook must be a string or null";
  if (b.value !== null && b.value !== undefined && typeof b.value !== "string") return "value must be a string or null";
  if (typeof b.playbook === "string" && typeof b.value !== "string") return "value is required with a playbook";
  if (b.cause !== "external" && b.cause !== "internal") return "cause must be external or internal";
  if (typeof b.summary !== "string" || !b.summary.trim() || b.summary.length > 2000) return "summary must be 1–2000 characters";
  if (b.evidence !== undefined && !(Array.isArray(b.evidence) && b.evidence.every((e: unknown) => typeof e === "string")))
    return "evidence must be an array of strings";
  if (b.nubiUrl !== undefined && b.nubiUrl !== null && typeof b.nubiUrl !== "string") return "nubiUrl must be a string";
  return { playbook: b.playbook, value: b.value ?? null, cause: b.cause, summary: b.summary, evidence: b.evidence ?? [], nubiUrl: b.nubiUrl ?? null };
}

// Validation order from CONTRACTS §3.5. `incident` is null when there is no Investigating incident.
export function checkFindings(f: Findings, incident: { alert: string } | null, pb: Playbook | null): { error: string; message: string } | null {
  if (!incident) return { error: "NO_OPEN_INCIDENT", message: "there is no Investigating incident" };
  if (f.playbook === null) return null;
  if (!pb) return { error: "UNKNOWN_PLAYBOOK", message: `${f.playbook} is not a playbook` };
  if (!pb.dimension.values.includes(f.value!))
    return { error: "VALUE_NOT_ALLOWED", message: `${f.value} is not in [${pb.dimension.values.join(", ")}]` };
  if (f.cause !== pb.match.cause) return { error: "CAUSE_MISMATCH", message: `${pb.id} is for cause ${pb.match.cause}, not ${f.cause}` };
  if (!pb.match.alerts.includes(incident.alert)) return { error: "ALERT_MISMATCH", message: `${pb.id} is not for alert ${incident.alert}` };
  return null;
}
