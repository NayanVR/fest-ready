// Background loops (ARCHITECTURE §5.4, §9.2, §9.6). They are separate timers, so a slow Flagsmith call in one never
// delays the other.
// - guardrail (every 5 s): a canary step in breach is rolled back automatically (actor "controller"). Steps advance
//   automatically only when the playbook sets recovery.auto_advance; starting recovery from PROBE_OK is always a human.
// - probe (every tick): while Mitigated, send the playbook's probe request every `probe.every`; FALLBACK → PROBE_OK once
//   probes have passed for `healthy_for` (checked every tick, not only after a probe), PROBE_OK → FALLBACK on a failure.
import type { Database } from "bun:sqlite";
import { warm } from "./flagsmith.ts";
import { act, incidentId, incidentPlaybook, probeResults, recordProbe, serial, stepGuardrail } from "./incidents.ts";
import { log } from "./log.ts";
import { listPlaybooks, parseDuration, render, type Playbook } from "./playbooks.ts";
import { probeStatus } from "./recovery.ts";

type Row = any;
const TICK_MS = 5000;
const PROBE_TICK_MS = 1000;

export async function guardrailTick(db: Database, now = Date.now()) {
  const rows = db.query<Row, []>("SELECT * FROM incidents WHERE state LIKE 'CANARY_%' AND step_started_at IS NOT NULL").all();
  for (const r of rows) {
    const pb = incidentPlaybook(r);
    if (!pb || !r.value) continue;
    const g = stepGuardrail(db, r, pb, now);
    const auto = pb.recovery.auto_advance === true && g.advanceAllowed;
    if (g.guardrail !== "breach" && !auto) continue;
    await serial(async () => {
      // Re-check inside the lock: an operator may have acted in the meantime.
      const fresh = db.query<Row, [number]>("SELECT * FROM incidents WHERE n = ?").get(r.n);
      if (fresh?.state !== r.state || fresh.step_started_at !== r.step_started_at) return;
      const current = incidentPlaybook(fresh);
      if (!current) return;
      const g2 = stepGuardrail(db, fresh, current, now);
      if (g2.guardrail === "breach")
        await act(db, incidentId(r.n), "controller", { type: "rollback" }, `automatic rollback: ${g2.breach ?? g2.reason}`, now);
      else if (current.recovery.auto_advance === true && g2.advanceAllowed)
        // Playbook opted in: once an operator started recovery, each step that passes its guardrail advances by itself.
        await act(db, incidentId(r.n), "controller", { type: "advance", guardrailPass: true, cooldownLeftMs: 0 },
          `automatic advance: guardrail passed (${g2.samples} samples, ${current.recovery.guardrail.window} window)`, now);
    });
  }
}

export async function sendProbe(pb: Playbook, value: string, synthetic = false): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const req = render(pb.probe.request, { value, probe_identity: pb.probe.identities[value]! });
    const body = synthetic ? { ...(req.body as Record<string, unknown>), synthetic: true } : req.body;
    const res = await fetch(req.url, {
      method: req.method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await res.body?.cancel();
    // fallback_active: the fallback answered for the probe identity, so the provider wasn't tested: not healthy.
    const error = res.status === pb.probe.expect.healthy.status ? null
      : res.status === pb.probe.expect.fallback_active.status ? "fallback_active" : `HTTP ${res.status}`;
    return { ok: error === null, status: res.status, error };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message };
  }
}

export async function probeTick(db: Database, send = sendProbe, now = () => Date.now()) {
  const rows = db.query<Row, []>("SELECT * FROM incidents WHERE state IN ('FALLBACK', 'PROBE_OK') AND fallback_at IS NOT NULL").all();
  for (const r of rows) {
    const pb = incidentPlaybook(r);
    if (!pb || !r.value) continue;
    const results = probeResults(db, r.n, r.fallback_at);
    const last = results.at(-1);
    if (!last || now() - last.ts >= parseDuration(pb.probe.every)) {
      const p = await send(pb, r.value);
      recordProbe(db, r.n, p.ok, p.status, p.error, now());
      if (r.state === "PROBE_OK" && !p.ok) {
        await serial(() => act(db, incidentId(r.n), "controller", { type: "probe", healthy: false }, `probe failed: ${p.error}`));
        continue;
      }
    }
    if (r.state === "FALLBACK" && probeStatus(pb, probeResults(db, r.n, r.fallback_at), r.fallback_at, now()).healthy)
      await serial(() => act(db, incidentId(r.n), "controller", { type: "probe", healthy: true }, `probe healthy for ${pb.probe.healthy_for}`));
  }
}

function every(ms: number, name: string, fn: () => Promise<void>) {
  let busy = false;
  setInterval(async () => {
    if (busy) return; // a slow tick never overlaps the next one
    busy = true;
    try {
      await fn();
    } catch (e) {
      log("error", `${name} tick failed`, { error: (e as Error).message });
    } finally {
      busy = false;
    }
  }, ms);
}

export function startLoops(db: Database) {
  // Warm Flagsmith IDs and state for every playbook value (a few calls per start), so the first action on any value
  // is one write + one read-back and its audit row has a real "before".
  for (const pb of listPlaybooks(db))
    for (const value of pb.dimension.values)
      warm(pb, value).catch((e) => log("warn", "flagsmith warm-up failed", { playbook: pb.id, value, error: e.message }));
  every(TICK_MS, "guardrail", () => guardrailTick(db));
  every(PROBE_TICK_MS, "probe", () => probeTick(db));
}
