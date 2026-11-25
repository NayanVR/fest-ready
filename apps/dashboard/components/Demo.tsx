"use client";
import { useState } from "react";
import { Btn, Notice, Pill, useAction } from "./ui";

export default function Demo({ providers }: { providers: string[] }) {
  const { busy, note, run } = useAction();
  const [last, setLast] = useState<Record<string, boolean>>({});
  const fault = (action: "outage" | "clear", provider: string) =>
    run(`${action === "outage" ? "Start" : "Clear"} ${provider}`, "fault", { action, provider })
      .then((r) => { if (r.ok) setLast((l) => ({ ...l, [provider]: !!r.json?.outage })); });
  return (
    <>
      <div className="titlerow"><h1>Demo controls</h1></div>
      <p className="sub">Start or clear a courier-provider outage. The controller forwards it to the partner mock; nothing here knows which city a provider serves.</p>
      <Notice n={note} />
      <section className="card">
        <div className="cardhead"><h2>Providers</h2></div>
        {providers.length === 0 && <div className="empty">DEMO_PROVIDERS is empty.</div>}
        {providers.map((p) => (
          <div className="row" key={p} style={{ padding: "10px 0", borderTop: "1px solid var(--rule)" }}>
            <strong style={{ fontWeight: 500, width: 100 }}>Provider {p}</strong>
            <span style={{ width: 120 }}>{p in last ? <Pill kind={last[p] ? "bad" : "ok"}>{last[p] ? "outage on" : "outage off"}</Pill> : <span className="muted">state not read</span>}</span>
            <Btn className="danger" busy={busy} label={`Start ${p}`} onClick={() => fault("outage", p)}>Start outage</Btn>
            <Btn busy={busy} label={`Clear ${p}`} onClick={() => fault("clear", p)}>Clear outage</Btn>
          </div>
        ))}
      </section>
    </>
  );
}
