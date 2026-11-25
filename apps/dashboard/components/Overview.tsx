"use client";
import Link from "next/link";
import Mascot, { type MascotMood } from "./Mascot";
import { IconAvailability, IconIncidents, IconReady, StatusIcon } from "./icons";
import { Banner, Loaded, Pill, fmt, pct, statusKind, usePoll } from "./ui";
import type { IncidentRow, PlaybookRow, State } from "@/lib/types";

function availabilityLabel(dimension: string) {
  if (dimension === "city") return "Delivery availability";
  if (dimension === "paymentCohort") return "Payment availability";
  return `${dimension} availability`;
}

export default function Overview(p: { state: Loaded<State>; incidents: Loaded<IncidentRow[]>; playbooks: Loaded<PlaybookRow[]> }) {
  const st = usePoll<State>("state", p.state);
  const inc = usePoll<IncidentRow[]>("incidents", p.incidents);
  const pb = usePoll<PlaybookRow[]>("playbooks", p.playbooks);
  const incidents = Array.isArray(inc.data) ? inc.data : [];
  const playbooks = Array.isArray(pb.data) ? pb.data : [];
  const s = st.data;
  const availability = new Map(s?.availabilityByDimension?.map((row) => [
    row.dimension, row.dimension === "city" ? row.primaryAvailability : row.availability,
  ]));
  const deliveryAvailability = s?.availabilityByDimension ? availability.get("city") :
    playbooks.length > 0 && playbooks.every((pb) => pb.dimension.name === "city") ? s?.availability : null;
  availability.delete("city");
  const serviceAvailability = [["city", deliveryAvailability], ...availability] as const;
  const open = incidents.filter((i) => !i.closedAt && i.status !== "Closed" && i.status !== "Resolved");
  const first = open[0];
  const has = (x: string) => open.some((i) => i.status === x);
  const mood: MascotMood = has("Investigating") ? "alert" : has("Recovering") ? "working" : has("Mitigated") ? "calm" : "happy";
  return (
    <>
      <div className="mc-head-row">
        <Mascot mood={mood} size={88} />
        <div>
          <div className="titlerow"><h1>Overview</h1></div>
          <p className="sub">
            {first
              ? <>Needs you: <Link href={`/incidents/${first.id}`}>{first.id}</Link> · {first.title} · {first.status}.</>
              : "No open incidents."}
          </p>
        </div>
      </div>
      <Banner error={st.error ?? inc.error ?? pb.error} />

      <div className={`kpis${availability.size ? " kpis-by-service" : ""}`}>
        {serviceAvailability.map(([dimension, value]) => (
          <div key={dimension}>
            <div className="label"><IconAvailability />{availabilityLabel(dimension)}</div>
            <div className={`val ${value == null ? "dim" : "data"}`}>{pct(value)}</div>
            <div className="note">{!s ? "Loading…" : value == null ? "No attempts in the last 5 min" : "Last 5 min, all cohorts"}</div>
          </div>
        ))}
        <div>
          <div className="label"><IconIncidents />Open incidents</div>
          <div className="val">{s?.openIncidents ?? "–"}</div>
          <div className="note">{s?.openIncidents ? "Not yet closed" : "Nothing needs action"}</div>
        </div>
        <div>
          <div className="label"><IconReady />Playbooks</div>
          <div className="val">{s ? s.playbooks.ready : "–"}<small>ready</small>{!!s?.playbooks.broken && <>{" "}{s.playbooks.broken}<small>broken</small></>}</div>
          <div className="note">{s && s.playbooks.broken === 0 ? "All pass their readiness check" : "Broken playbooks cannot be applied"}</div>
        </div>
      </div>

      <div className="cols eq overview-cols">
        <div className="card">
          <div className="cardhead"><h2>Incidents</h2><span className="muted">{incidents.length} total, newest first</span></div>
          <div className="scroll">
            <table className="incs">
              <thead><tr><th>ID</th><th>Title</th><th>Status</th><th className="hide-sm">Owner</th><th className="hide-sm">Opened</th></tr></thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="id"><Link href={`/incidents/${i.id}`}>{i.id}</Link></td>
                    <td>{i.title}</td>
                    <td><Pill kind={statusKind(i.status)}><StatusIcon status={i.status} />{i.status ?? "–"}</Pill></td>
                    <td className="hide-sm">{i.owner ?? <span className="muted">–</span>}</td>
                    <td className="hide-sm">{fmt(i.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {incidents.length === 0 && <div className="empty">No incidents yet.</div>}
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
