"use client";
import { useState } from "react";
import { Banner, Loaded, fmt, usePoll } from "./ui";
import type { AuditRow, FlagState } from "@/lib/types";

// Flag state per CONTRACTS §3.4: {fallbackActive, fallbackEnabled, fallbackValue, splitPercent}.
const flat = (s: FlagState) =>
  s == null ? "–" : `fallback ${s.fallbackActive ? "on" : "off"} (enabled=${s.fallbackEnabled}${s.fallbackValue != null ? `, value=${s.fallbackValue}` : ""}), split ${s.splitPercent}%`;
const same = (a: FlagState, b: FlagState) => JSON.stringify(a) === JSON.stringify(b);

export default function Audit({ initial }: { initial: Loaded<AuditRow[]> }) {
  const [inc, setInc] = useState("");
  const q = inc.trim();
  const { data, error } = usePoll<AuditRow[]>(`audit${q ? `?incident=${encodeURIComponent(q)}` : ""}`, q ? undefined : initial);
  const rows = Array.isArray(data) ? data : [];
  return (
    <>
      <div className="titlerow"><h1>Audit log</h1></div>
      <p className="sub">Every controller and operator action, newest first. Flag changes show the state before, after and as read back from Flagsmith.</p>
      <Banner error={error} />
      <section className="card">
        <div className="cardhead">
          <h2>Actions</h2><span className="muted">{rows.length} rows</span><span className="sp" />
          <input aria-label="Filter by incident" placeholder="Filter: INC-0042" value={inc} onChange={(e) => setInc(e.target.value)} style={{ width: 200 }} />
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Time</th><th>Incident</th><th>Actor</th><th>Action</th><th>Flag state: before → after, read back</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td title={r.ts} style={{ whiteSpace: "nowrap" }}>{fmt(r.ts)}</td>
                  <td className="id" style={{ whiteSpace: "nowrap" }}>{r.incidentId ?? "–"}</td>
                  <td>{r.actor}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.before == null && r.after == null && r.readBack == null ? <span className="muted">–</span> : <>
                      <div>{flat(r.before)} → {flat(r.after)}</div>
                      {r.readBack != null && <div className="muted">read back: {flat(r.readBack)}{r.after != null && !same(r.after, r.readBack) ? " — differs from after" : ""}</div>}
                    </>}
                  </td>
                  <td>{r.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="empty">No audit rows{q ? ` for ${q}` : ""}.</div>}
      </section>
    </>
  );
}
