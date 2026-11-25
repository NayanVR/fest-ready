"use client";
import { useState } from "react";
import { Banner, Bar, Btn, Loaded, Notice, Pill, clock, fmt, money, pct, statusKind, useAction, usePoll } from "./ui";
import type { Evidence, Incident as Inc, Playbook, PlaybookRow, Recovery } from "@/lib/types";

// healthySince → seconds. `probe.healthyFor` from the controller is the *required* duration (playbook healthy_for), not elapsed.
const secs = (since: string) => `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s`;

const STEPS = ["Investigating", "Mitigated", "Recovering", "Resolved", "Closed"] as const;

// Why Advance is disabled, using only fields the controller sends (CONTRACTS §3.4).
function whyNot(rec: Recovery, probe: Inc["probe"]): string {
  if (rec.reason) return rec.reason[0]!.toUpperCase() + rec.reason.slice(1) + "."; // the controller says why (breach, cooldown, samples…)
  if ((rec.state === "NORMAL" || rec.state === "CLOSED")) return "Recovery is complete.";
  if (rec.state === "FALLBACK")
    return probe?.healthy ? `Provider probe has been healthy for ${probe.healthyFor ?? "–"}; waiting for the playbook's healthy-for time.`
                          : "Waiting for the provider probe to be healthy again.";
  if (rec.guardrail === "breach") return "Guardrail breached. The controller rolls back by itself.";
  if (rec.samples < rec.minSamples) return `Waiting for samples: ${rec.samples} of ${rec.minSamples}.`;
  return "Waiting for the guardrail window to finish.";
}

export default function Incident({ id, initial }: { id: string; initial: Loaded<Inc> }) {
  const { data: inc, error, reload } = usePoll<Inc>(`incidents/${encodeURIComponent(id)}`, initial);
  const { data: pb } = usePoll<Playbook>(inc?.playbook ? `playbooks/${inc.playbook}` : null);
  const { data: ev } = usePoll<Evidence>(inc?.recovery ? `incidents/${encodeURIComponent(id)}/evidence` : null, undefined, 10000);
  const { busy, note, run } = useAction();
  const [closing, setClosing] = useState("");

  if (!inc) return (
    <>
      <div className="titlerow"><h1 className="id">{id}</h1></div>
      <Banner error={error ?? "Incident not loaded"} />
    </>
  );

  const act = (label: string, action: string, body: unknown, after?: () => void) =>
    run(label, `incidents/${id}/${action}`, body, () => { reload(); after?.(); });

  const rec = inc.recovery;
  const f = inc.findings;
  const idx = STEPS.indexOf(inc.status as (typeof STEPS)[number]);
  const stepTs = [inc.openedAt, inc.mitigatedAt, null, inc.resolvedAt, inc.closedAt];
  const fallbackSeg = pb?.segments?.fallback.replace("{value}", inc.value ?? "");
  const steps = pb?.recovery?.steps ?? [];
  const nextStep = rec ? steps.find((s) => s > rec.splitPercent) : undefined;
  // NORMAL = fallback switched off again: the controller reports split 0, but every customer is back on delivery.
  const shown = (rec?.state === "NORMAL" || rec?.state === "CLOSED") ? 100 : rec?.splitPercent ?? 0;
  const done = inc.status === "Resolved" || inc.status === "Closed";
  const lastOk = !!inc.probe?.last?.length && inc.probe.last[inc.probe.last.length - 1]!;

  return (
    <>
      <div className="titlerow">
        <h1 className="id" style={{ fontFamily: "var(--font)" }}>{inc.id}</h1>
        <Pill kind={statusKind(inc.status)}>{inc.status}</Pill>
        <span className="sp" />
        <span className="muted">Owner {inc.owner ?? "–"}</span>
        {!inc.owner && <Btn busy={busy} label="Take ownership" onClick={() => act("Take ownership", "ack", {})}>Take ownership</Btn>}
      </div>
      <p className="sub">{inc.title}{inc.title.includes(inc.alert) ? "" : ` · alert ${inc.alert}`}</p>
      <Banner error={error} />
      <Notice n={note} />

      <ol className="steps" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Ticket status">
        {STEPS.map((s, i) => (
          <li key={s} className={`step ${i === idx ? "now" : i < idx ? "done" : ""}`} aria-current={i === idx ? "step" : undefined}>
            {s}<small>{stepTs[i] ? fmt(stepTs[i]) : ""}</small>
          </li>
        ))}
      </ol>

      <div className="cols">
        <div>
          <section className="card focus">
            <div className="cardhead">
              <h2>Findings</h2>
              {f && <><Pill>{f.source}</Pill><span className="muted">{fmt(f.submittedAt)}</span></>}
              <span className="sp" />
              {f?.nubiUrl && <a href={f.nubiUrl} target="_blank" rel="noreferrer">Open the NuBi investigation ↗</a>}
            </div>
            {f ? (
              <>
                <div className="meta">
                  <span>Cause <strong style={{ fontWeight: 500 }}>{f.cause}</strong></span>
                  {inc.playbook
                    ? <span>Playbook <span className="id">{inc.playbook}</span> · {pb?.dimension?.name ?? "value"} <strong style={{ fontWeight: 500 }}>{inc.value}</strong></span>
                    : <span>No playbook fits</span>}
                </div>
                <div className="summary">{f.summary}</div>
                {f.evidence && f.evidence.length > 0 && <ul className="plain">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  Waiting for NuBi's findings. The controller doesn't diagnose, so there is no recommendation yet.
                  If NuBi is unavailable, the operator form below submits findings marked <span className="id">source: operator</span>.
                </p>
                <FindingsForm busy={busy} onSubmit={(b) => act("Submit findings", "findings", { ...b, source: "operator" })} />
              </>
            )}
          </section>

          {f && inc.status === "Investigating" && (
            <section className="card">
              <h2>Recommendation</h2>
              {inc.playbook ? (
                <>
                  <p style={{ marginTop: 8, maxWidth: "70ch" }}>
                    Apply <strong style={{ fontWeight: 500 }}>{inc.playbook}</strong>
                    {pb?.dimension && <> to {pb.dimension.name} <strong style={{ fontWeight: 500 }}>{inc.value}</strong> only</>}
                    {pb?.flag && <>: set flag <code>{pb.flag.key}</code> to enabled={String(pb.flag.fallback.enabled)}
                      {fallbackSeg && <> for segment <code>{fallbackSeg}</code></>}. Nothing else changes.</>}
                    {steps.length > 0 && <> Recovery later in steps {steps.join("% → ")}%, each one approved by an operator.</>}
                  </p>
                  <div className="actions">
                    <Btn className="primary" busy={busy} label="Approve" onClick={() => act("Approve", "approve", {})}>Approve</Btn>
                    <span className="muted">Approving can take up to ~30 s while Flagsmith confirms the change.</span>
                  </div>
                </>
              ) : (
                <p className="muted" style={{ marginTop: 8 }}>No playbook applies. Handle it manually, then close with a note.</p>
              )}
            </section>
          )}

          {rec && inc.status !== "Investigating" && (
            <section className={`card focus${done ? "" : " first"}`}>
              <div className="cardhead">
                <h2>Recovery</h2>
                <Pill>{rec.state}</Pill>
                {!(rec.state === "NORMAL" || rec.state === "CLOSED") && <Pill kind={rec.guardrail === "pass" ? "ok" : rec.guardrail === "breach" ? "bad" : "warn"}>guardrail: {rec.guardrail}</Pill>}
                <span className="sp" />
                <span className="muted">{rec.autoAdvance ? "start: operator · steps: automatic · rollback: automatic" : "advance: operator · rollback: automatic"}</span>
              </div>
              <div className="bignum">{shown}%<small>{(rec.state === "NORMAL" || rec.state === "CLOSED") ? `of ${inc.value ?? "the value"}'s customers on delivery · fallback is off` : `of ${inc.value ?? "the value"}'s customers back on delivery · observed ${rec.observedSharePercent == null ? "–" : `${rec.observedSharePercent}%`}`}</small></div>
              {steps.length > 0 && (
                <div className="ladder" aria-label="Recovery steps">
                  {[0, ...steps].map((s) => (
                    <div key={s} className={`${s > 0 && s <= shown ? "on" : ""} ${s === shown ? "now" : ""}`}>{s}%</div>
                  ))}
                </div>
              )}
              {!(rec.state === "NORMAL" || rec.state === "CLOSED") && <div className="metrics">
                <div>
                  <div className="muted">Samples</div>
                  <div>{rec.samples} <span className="muted">of {rec.minSamples} needed</span></div>
                  <Bar value={rec.samples} max={rec.minSamples} />
                </div>
                <div>
                  <div className="muted">Error rate</div>
                  <div>{pct(rec.errorRate)} <span className="muted">max {pct(rec.maxErrorRate)}</span></div>
                  <Bar value={rec.errorRate ?? 0} max={rec.maxErrorRate} bad={(rec.errorRate ?? 0) > rec.maxErrorRate} />
                </div>
                <div>
                  <div className="muted">Consecutive errors</div>
                  <div>{rec.consecutiveErrors}</div>
                </div>
              </div>}
              <div className="actions">
                <Btn className="primary" busy={busy} label="Advance" disabled={!rec.advanceAllowed || done}
                  onClick={() => act("Advance", "advance", {})}>
                  {(rec.state === "NORMAL" || rec.state === "CLOSED") ? "Advance"
                    : rec.state === "PROBE_OK" || rec.state === "FALLBACK" ? `Start recovery at ${steps[0] ?? "first step"}%`
                    : nextStep ? `Advance to ${nextStep}%` : "Finish recovery (fallback off)"}
                </Btn>
                <Btn className="danger" busy={busy} label="Rollback" disabled={rec.splitPercent === 0 || done}
                  onClick={() => act("Rollback", "rollback", {})}>Rollback to 0%</Btn>
                {!rec.advanceAllowed && !done && <span className="muted">{whyNot(rec, inc.probe)}{rec.autoAdvance && rec.state.startsWith("CANARY_") ? " Advances by itself when the guardrail passes." : ""}</span>}
              </div>
            </section>
          )}

        </div>

        <div>
          <section className="card">
            <h2>Business impact</h2>
            {inc.impact ? (
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>Orders failed</dt><dd>{inc.impact.ordersFailed} · {money(inc.impact.amountFailed)}</dd>
                <dt>Orders saved</dt><dd>{inc.impact.ordersSaved} · {money(inc.impact.amountSaved)}</dd>
                <dt>At risk per minute</dt><dd>{money(inc.impact.atRiskPerMinute)}</dd>
                <dt>Customers affected</dt><dd>{inc.impact.customersAffected}</dd>
              </dl>
            ) : <p className="muted" style={{ marginTop: 8 }}>Counted once findings name the value.</p>}
          </section>

          <section className="card">
            <h2>Provider probe</h2>
            {inc.probe ? (
              <>
                <div className="row" style={{ marginTop: 8 }}>
                  <Pill kind={inc.probe.healthy ? "ok" : lastOk ? "warn" : "bad"}>{inc.probe.healthy ? "healthy" : lastOk ? "recovering" : "unhealthy"}</Pill>
                  {inc.probe.healthySince && lastOk && (
                    <span className="muted" suppressHydrationWarning>
                      {inc.probe.healthy ? "ok" : "ok so far"} for {secs(inc.probe.healthySince)}
                      {inc.probe.healthyFor && !inc.probe.healthy ? ` of ${inc.probe.healthyFor} needed` : ""} · since {clock(inc.probe.healthySince)}
                    </span>
                  )}
                </div>
                <div className="dots" role="img" aria-label={`Last ${(inc.probe.last ?? []).length} probes, oldest first`}>
                  {(inc.probe.last ?? []).map((ok, i) => <span key={i} className={`dot ${ok ? "" : "f"}`} />)}
                </div>
              </>
            ) : <p className="muted" style={{ marginTop: 8 }}>Probing starts after Approve.</p>}
          </section>

          {rec && (
            <section className="card">
              <h2>Provider evidence</h2>
              <p className="muted" style={{ margin: "4px 0 12px" }}>Order events for {inc.value}, for the provider's invoice review.</p>
              {ev && typeof ev.failedAttempts === "number" && (
                <dl className="kv" style={{ marginBottom: 12 }}>
                  <dt>Failed attempts</dt><dd>{ev.failedAttempts}</dd>
                  <dt>Customers affected</dt><dd>{ev.customersAffected}</dd>
                  <dt>By outcome</dt><dd>{Object.entries(ev.byOutcome ?? {}).map(([k, n]) => `${k} ${n}`).join(" · ") || "–"}</dd>
                  <dt>Window</dt><dd>{clock(ev.from)}–{clock(ev.to)}</dd>
                </dl>
              )}
              <div className="row">
                <a className="btn" href={`/api/c/incidents/${id}/evidence`} download={`${id}-evidence.json`}>Download JSON</a>
                <a className="btn" href={`/api/c/incidents/${id}/evidence?format=csv`} download={`${id}-evidence.csv`}>Download CSV</a>
              </div>
            </section>
          )}

          {inc.status === "Closed" && (
            <section className="card">
              <h2>Closed</h2>
              <p style={{ marginTop: 8 }}>{inc.closeNote || "No closing note."}</p>
              <p className="muted">{fmt(inc.closedAt)}</p>
            </section>
          )}

          {inc.status !== "Closed" && (
            <section className="card">
              <h2>Close incident</h2>
              <form className="form" style={{ marginTop: 8 }} onSubmit={async (e) => {
                e.preventDefault();
                await act("Close", "close", { note: closing.trim() }, () => setClosing(""));
              }}>
                <label>Closing note (required)
                  <textarea value={closing} onChange={(e) => setClosing(e.target.value)} required />
                </label>
                <div><Btn busy={busy} label="Close" disabled={!closing.trim()}>Close incident</Btn></div>
              </form>
            </section>
          )}
        </div>
      </div>

      <section className="card">
        <div className="cardhead"><h2>Timeline</h2><span className="muted">{(inc.timeline ?? []).length} entries</span></div>
        <div className="scroll">
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Result</th></tr></thead>
            <tbody>
              {[...(inc.timeline ?? [])].reverse().map((t, i) => (
                <tr key={i}><td title={t.ts}>{clock(t.ts)}</td><td>{t.actor}</td><td>{t.action}</td><td>{t.result}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {(inc.timeline ?? []).length === 0 && <div className="empty">Nothing yet.</div>}
      </section>
    </>
  );
}

// Safety-net form: same fields as MCP submit_findings (CONTRACTS §3.5), sent with source "operator".
function FindingsForm({ onSubmit, busy }: { onSubmit: (b: object) => void; busy: string | null }) {
  const { data } = usePoll<PlaybookRow[]>("playbooks");
  const pbs = Array.isArray(data) ? data : [];
  const [playbook, setPlaybook] = useState("");
  const [value, setValue] = useState("");
  const [cause, setCause] = useState("external");
  const [summary, setSummary] = useState("");
  const [evidence, setEvidence] = useState("");
  const sel = pbs.find((p) => p.id === playbook);
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        playbook: playbook || null, value: playbook ? value : null, cause, summary: summary.trim(),
        evidence: evidence.split("\n").map((s) => s.trim()).filter(Boolean),
      });
    }}>
      <div className="row">
        <label>Playbook
          <select value={playbook} onChange={(e) => {
            setPlaybook(e.target.value); setValue("");
            const m = pbs.find((p) => p.id === e.target.value)?.match?.cause;
            if (m) setCause(m);
          }}>
            <option value="">None (no playbook fits)</option>
            {pbs.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
        </label>
        {playbook && (
          <label>{sel?.dimension?.name ?? "Value"}
            <select value={value} onChange={(e) => setValue(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {sel?.dimension?.values?.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}
        <label>Cause
          <select value={cause} onChange={(e) => setCause(e.target.value)}>
            <option value="external">external</option><option value="internal">internal</option>
          </select>
        </label>
      </div>
      <label>Summary (max 2000 characters)
        <textarea value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} required />
      </label>
      <label>Evidence (one per line, optional)
        <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <div><Btn className="primary" busy={busy} label="Submit findings" disabled={!summary.trim() || (!!playbook && !value)}>Submit findings</Btn></div>
    </form>
  );
}
