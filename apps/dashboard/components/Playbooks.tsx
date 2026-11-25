"use client";
import { Banner, Btn, Loaded, Notice, Pill, usePoll, useAction } from "./ui";
import type { PlaybookRow } from "@/lib/types";

export default function Playbooks({ initial }: { initial: Loaded<PlaybookRow[]> }) {
  const { data, error, reload } = usePoll<PlaybookRow[]>("playbooks", initial);
  const { busy, note, run } = useAction();
  const list = Array.isArray(data) ? data : [];
  return (
    <>
      <div className="titlerow"><h1>Playbooks</h1></div>
      <p className="sub">Stored in the controller. A broken playbook cannot be applied; the reasons say what to fix.</p>
      <Banner error={error} />
      <Notice n={note} />
      {list.length === 0 && <div className="empty">No playbooks loaded.</div>}
      {list.map((p) => (
        <section className="card" key={p.id}>
          <div className="cardhead">
            <h2 className="id" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{p.id}</h2>
            {p.version != null && <span className="muted">v{p.version}</span>}
            <Pill kind={p.readiness === "ready" ? "ok" : "bad"}>{p.readiness}</Pill>
            <span className="sp" />
            <Btn busy={busy} label={`Check ${p.id}`} onClick={() => run(`Check ${p.id}`, `playbooks/${p.id}/check`, {}, reload)}>Run readiness check</Btn>
          </div>
          {p.description && <p style={{ maxWidth: "80ch", marginBottom: 12 }}>{p.description}</p>}
          {p.reasons.length > 0 && <ul className="plain" style={{ color: "var(--bad-ink)", marginBottom: 12 }}>{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <dl className="kv" style={{ maxWidth: 720 }}>
            {p.owner && <><dt>Owner</dt><dd>{p.owner}</dd></>}
            {p.match && <><dt>Alerts</dt><dd>{p.match.alerts?.join(", ")} · cause {p.match.cause}</dd></>}
            {p.dimension && <><dt>{p.dimension.name}</dt><dd>{p.dimension.values?.join(", ")}</dd></>}
            {p.flag && <><dt>Flag</dt><dd><code>{p.flag.key}</code> · fallback enabled={String(p.flag.fallback?.enabled)}</dd></>}
            {p.recovery && <><dt>Recovery</dt><dd>{p.recovery.method} · {p.recovery.steps?.join("% → ")}%</dd></>}
          </dl>
        </section>
      ))}
    </>
  );
}
