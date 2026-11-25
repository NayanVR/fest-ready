"use client";
import Link from "next/link";
import { Banner, Loaded, Pill, fmt, pct, statusKind, usePoll } from "./ui";
import type { IncidentRow, PlaybookRow, State } from "@/lib/types";

export default function Overview(p: { state: Loaded<State>; incidents: Loaded<IncidentRow[]>; playbooks: Loaded<PlaybookRow[]> }) {
  const st = usePoll<State>("state", p.state);
  const inc = usePoll<IncidentRow[]>("incidents", p.incidents);
  const pb = usePoll<PlaybookRow[]>("playbooks", p.playbooks);
  const incidents = Array.isArray(inc.data) ? inc.data : [];
  const playbooks = Array.isArray(pb.data) ? pb.data : [];
  const s = st.data;
  const open = incidents.filter((i) => !i.closedAt && i.status !== "Closed" && i.status !== "Resolved");
  const first = open[0];
  return (
    <>
      <div className="titlerow"><h1>Overview</h1></div>
      <p className="sub">
        {first
          ? <>Needs you: <Link href={`/incidents/${first.id}`}>{first.id}</Link> · {first.title} · {first.status}.</>
          : "Overall delivery availability only. Any breakdown appears once findings exist."}
      </p>
      <Banner error={st.error ?? inc.error ?? pb.error} />

      <div className="kpis">
        <div>
          <div className="label">Delivery availability</div>
          <div className={`val ${s?.availability == null ? "dim" : "data"}`}>{pct(s?.availability)}</div>
          <div className="note">{!s ? "Loading…" : s.availability == null ? "No orders in the last 5 min" : "Last 5 min, all values together"}</div>
        </div>
        <div>
          <div className="label">Open incidents</div>
          <div className="val">{s?.openIncidents ?? "–"}</div>
          <div className="note">{s?.openIncidents ? "Not yet closed" : "Nothing needs action"}</div>
        </div>
        <div>
          <div className="label">Playbooks</div>
          <div className="val">{s ? s.playbooks.ready : "–"}<small>ready</small>{!!s?.playbooks.broken && <>{" "}{s.playbooks.broken}<small>broken</small></>}</div>
          <div className="note">{s && s.playbooks.broken === 0 ? "All pass their readiness check" : "Broken playbooks cannot be applied"}</div>
        </div>
      </div>

      <div className="cols eq" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div className="card">
          <div className="cardhead"><h2>Incidents</h2><span className="muted">{incidents.length} total, newest first</span></div>
          <div className="scroll">
            <table>
              <thead><tr><th>ID</th><th>Title</th><th>Status</th><th className="hide-sm">Owner</th><th className="hide-sm">Opened</th></tr></thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="id"><Link href={`/incidents/${i.id}`}>{i.id}</Link></td>
                    <td>{i.title}</td>
                    <td><Pill kind={statusKind(i.status)}>{i.status ?? "–"}</Pill></td>
                    <td className="hide-sm">{i.owner ?? <span className="muted">–</span>}</td>
                    <td className="hide-sm">{fmt(i.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {incidents.length === 0 && <div className="empty">No incidents. When delivery drops, the alert opens one here.</div>}
        </div>
        <div className="card">
          <div className="cardhead"><h2>Playbook readiness</h2><span className="sp" /><Link href="/playbooks">View all</Link></div>
          {playbooks.length === 0 && <div className="empty">No playbooks loaded.</div>}
          {playbooks.map((x) => (
            <div key={x.id} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
              <Pill kind={x.readiness === "ready" ? "ok" : "bad"}>{x.readiness}</Pill>
              <span className="id">{x.id}</span>
              {x.reasons?.[0] && <span className="muted">{x.reasons[0]}</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
