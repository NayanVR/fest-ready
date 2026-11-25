"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconPrint } from "./icons";

// Screen-only bar on the report: pick a language (reloads with ?lang) and print to PDF.
export default function ReportToolbar({ id, lang, langs }: { id: string; lang: string; langs: string[][] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="r-bar">
      <a href={`/incidents/${encodeURIComponent(id)}`}>← {id}</a>
      <span className="sp" />
      <label className="r-lang">Language
        <select value={lang} disabled={pending} onChange={(e) => start(() => router.push(`?lang=${e.target.value}`))}>
          {langs.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </label>
      {pending && <span className="muted" role="status">Translating…</span>}
      <button className="primary" onClick={() => window.print()} disabled={pending}><IconPrint size={16} />Save as PDF</button>
    </div>
  );
}
