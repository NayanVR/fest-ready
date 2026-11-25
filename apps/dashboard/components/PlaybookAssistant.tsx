"use client";
// Chat sidebar that drafts a playbook with Sarvam (server route /api/assistant). It never saves: "Apply to wizard" hands the
// draft to the parent, and the operator reviews and saves it in the wizard.
import { useEffect, useRef, useState } from "react";
import { Pill } from "./ui";
import "./playbook-assistant.css";

type Readiness = { readiness: string; reasons: string[] } | null;
type Turn = { role: "user" | "assistant"; content: string; draft?: any; readiness?: Readiness; questions?: string[]; error?: boolean };

const STARTERS = [
  "A courier provider fails in one region; switch that region to pickup",
  "A payment gateway fails for one bank; route that bank to a backup gateway",
  "Explain what you need from me to draft a playbook",
];

function DraftCard({ draft, readiness, onApply }: { draft: any; readiness?: Readiness; onApply: () => void }) {
  const kind = readiness?.readiness === "ready" ? "ok" : readiness?.readiness === "broken" || readiness?.readiness === "invalid" ? "bad" : "warn";
  const state = (s: any) => (s ? `${s.enabled ? "on" : "off"}${s.value !== undefined ? ` · ${JSON.stringify(s.value)}` : ""}` : "–");
  const steps = draft?.recovery?.steps;
  return (
    <div className="pa-card">
      <div className="pa-card-head">
        <code>{draft?.id ?? "(no id)"}</code>
        <Pill kind={kind}>{readiness?.readiness ?? "not checked"}</Pill>
      </div>
      <dl>
        <dt>Dimension</dt><dd>{draft?.dimension?.name ?? "–"}: {Array.isArray(draft?.dimension?.values) ? draft.dimension.values.join(", ") : "–"}</dd>
        <dt>Flag</dt><dd><code>{draft?.flag?.key ?? "–"}</code> normal {state(draft?.flag?.normal)}, fallback {state(draft?.flag?.fallback)}</dd>
        <dt>Steps</dt><dd>{Array.isArray(steps) ? steps.map((s: number) => `${s}%`).join(" → ") : "–"}{draft?.recovery?.auto_advance ? ", auto-advance" : ""}</dd>
      </dl>
      {readiness?.reasons?.length ? <ul className="pa-reasons">{readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      <button className="primary" onClick={onApply}>Apply to wizard</button>
    </div>
  );
}

// `inline`: a panel that lives in the page (the wizard's side column) instead of a drawer; always open.
export default function PlaybookAssistant({ open = true, onClose = () => {}, draft, onApply, inline = false }: {
  open?: boolean; onClose?: () => void; draft?: object; onApply: (draft: object) => void; inline?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open && !inline) input.current?.focus(); }, [open, inline]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);
  useEffect(() => {
    if (!open || inline) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose, inline]);

  // The newest assistant draft wins over the wizard's draft, so follow-ups edit what the chat produced.
  const latest = [...turns].reverse().find((t) => t.draft)?.draft ?? draft;

  async function send(content: string) {
    content = content.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((t) => !t.error).map(({ role, content }) => ({ role, content })), draft: latest }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? `Assistant returned ${r.status}`);
      setTurns([...next, { role: "assistant", content: j.reply || (j.draft ? "Here is a draft." : "No reply."), draft: j.draft ?? undefined, readiness: j.readiness, questions: j.questions }]);
    } catch (e) {
      setTurns([...next, { role: "assistant", content: e instanceof Error ? e.message : "Request failed", error: true }]);
    } finally { setBusy(false); }
  }

  if (!open) return null;
  const panel = (
      <aside className={`pa${inline ? " pa-inline" : ""}`} role={inline ? "complementary" : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="pa-title">
        <header className="pa-head">
          <div>
            <h2 id="pa-title">{inline ? "Ask AI" : "Playbook assistant"}</h2>
            <p className="muted">AI draft by Sarvam — review before saving</p>
          </div>
          {!inline && <button onClick={onClose} aria-label="Close assistant">Close</button>}
        </header>

        <div className="pa-list" ref={list} aria-live="polite">
          {!turns.length && (
            <div className="pa-empty">
              <p>Describe what fails and what customers should get instead. The assistant drafts a full playbook from live flags and event fields, and checks it against the controller.</p>
              <div className="pa-starters">
                {STARTERS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`pa-msg ${t.role}${t.error ? " error" : ""}`}>
              <p>{t.content}</p>
              {t.questions?.length ? <ul className="pa-questions">{t.questions.map((q) => <li key={q}>{q}</li>)}</ul> : null}
              {t.draft && <DraftCard draft={t.draft} readiness={t.readiness} onApply={() => { onApply(t.draft); setApplied(i); }} />}
              {applied === i && <p className="muted pa-applied">Applied. Review every field in the wizard, then save.</p>}
            </div>
          ))}
          {busy && <div className="pa-msg assistant pa-thinking" role="status">Thinking… this can take up to a minute.</div>}
        </div>

        <form className="pa-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea
            ref={input} rows={2} value={text} placeholder="What fails, and what should customers get instead?"
            aria-label="Message the playbook assistant" disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }}
          />
          <button className="primary" type="submit" disabled={busy || !text.trim()}>Send</button>
        </form>
      </aside>
  );
  return inline ? panel : (
    <div className="pa-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{panel}</div>
  );
}
