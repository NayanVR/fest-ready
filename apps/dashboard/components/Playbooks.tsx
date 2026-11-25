"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Btn, Loaded, Notice, Pill, usePoll, useAction } from "./ui";
import type { Note } from "./ui";
import type { Playbook, PlaybookRow } from "@/lib/types";
import { playbookTemplates } from "@/lib/playbook-templates";
import PlaybookWizard from "./PlaybookWizard";

export default function Playbooks({ initial, defaultOwner, paymentProbeEnabled }: {
  initial: Loaded<PlaybookRow[]>;
  defaultOwner?: string;
  paymentProbeEnabled?: boolean;
}) {
  const { data, error, reload } = usePoll<PlaybookRow[]>("playbooks", initial);
  const { busy, note, run } = useAction();
  const [wizard, setWizard] = useState<{ playbook?: Playbook; draft?: Omit<Playbook, "version"> }>();
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [opening, setOpening] = useState<string>();
  const [feedback, setFeedback] = useState<Note>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const templatePicker = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (choosingTemplate) templatePicker.current?.focus();
    else if (!wizard && !opening) opener.current?.focus();
  }, [wizard, opening, choosingTemplate]);

  async function edit(id: string) {
    setOpening(id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/c/playbooks/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.message ?? `Could not load ${id} (HTTP ${response.status}).`);
      setWizard({ playbook: body });
    } catch (error) {
      setFeedback({ ok: false, text: (error as Error).message });
    } finally {
      setOpening(undefined);
    }
  }

  const list = Array.isArray(data) ? data : [];
  const disabled = Boolean(wizard || choosingTemplate || opening || busy);
  return (
    <>
      <div className="titlerow">
        <h1>Playbooks</h1>
        <span className="sp" />
        <button disabled={disabled} onClick={(event) => {
          opener.current = event.currentTarget;
          setFeedback(null);
          setTemplateIndex(0);
          setChoosingTemplate(true);
        }}>Create playbook from template</button>
        <button className="primary" disabled={disabled} onClick={(event) => {
          opener.current = event.currentTarget;
          setFeedback(null);
          setWizard({});
        }}>New playbook</button>
      </div>
      <p className="sub">Stored in the controller. A broken playbook cannot be applied; the reasons say what to fix.</p>
      <Banner error={error} />
      <Notice n={note} />
      <Notice n={feedback} />
      {choosingTemplate && <section className="card" aria-labelledby="playbook-template-title">
        <div className="cardhead"><h2 id="playbook-template-title">Choose a template</h2></div>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          setWizard({ draft: { ...playbookTemplates[templateIndex]!.draft, owner: defaultOwner ?? "" } });
          setChoosingTemplate(false);
        }}>
          <label>Template
            <select ref={templatePicker} value={templateIndex} onChange={(event) => setTemplateIndex(Number(event.target.value))}>
              {playbookTemplates.map(({ title }, index) => <option key={title} value={index}>{title}</option>)}
            </select>
          </label>
          <p className="muted">{playbookTemplates[templateIndex]!.description}</p>
          <div className="actions wizard-actions">
            <button type="button" onClick={() => setChoosingTemplate(false)}>Cancel</button>
            <button className="primary" type="submit">Use template</button>
          </div>
        </form>
      </section>}
      {wizard && <PlaybookWizard {...wizard} defaultOwner={defaultOwner} paymentProbeEnabled={paymentProbeEnabled} onCancel={() => setWizard(undefined)} onSave={(saved) => {
        setWizard(undefined);
        setFeedback({ ok: true, text: `Saved ${saved.id} · v${saved.version}` });
        void reload();
      }} />}
      {list.length === 0 && <div className="empty">No playbooks loaded.</div>}
      {list.map((p) => (
        <section className="card playbook-card" key={p.id}>
          <div className="cardhead">
            <h2 className="id" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{p.id}</h2>
            {p.version != null && <span className="muted">v{p.version}</span>}
            <Pill kind={p.readiness === "ready" ? "ok" : "bad"}>{p.readiness}</Pill>
            <span className="sp" />
            <button disabled={disabled} aria-label={`Edit ${p.id}`} onClick={(event) => {
              opener.current = event.currentTarget;
              void edit(p.id);
            }}>{opening === p.id ? "Opening…" : "Edit"}</button>
            <Btn busy={busy} disabled={disabled} label={`Check ${p.id}`} onClick={() => run(`Check ${p.id}`, `playbooks/${p.id}/check`, {}, reload)}>Run readiness check</Btn>
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
