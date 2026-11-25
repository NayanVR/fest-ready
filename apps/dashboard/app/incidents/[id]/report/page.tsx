// Incident report, printable to A4 (browser print → PDF), with headings and our own sentences machine-translated by Sarvam.
// NuBi's findings, the closing note and the timeline stay in their original English; translations sit in labelled boxes below.
import Mascot, { type MascotMood } from "@/components/Mascot";
import ReportToolbar from "@/components/ReportToolbar";
import { load } from "@/lib/server";
import { LANGS, isLang, translateAll, type Lang } from "@/lib/sarvam";
import type { Evidence, Incident } from "@/lib/types";
import "./report.css";

export const dynamic = "force-dynamic";

const SCRIPT: Partial<Record<Lang, string>> = {
  hi: "Devanagari", mr: "Devanagari", kn: "Kannada", ta: "Tamil", te: "Telugu", bn: "Bengali", gu: "Gujarati",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Controller timestamps are UTC ISO strings; shown as sent so the report matches the dashboard.
const date = (ts?: string | null) =>
  typeof ts === "string" && ts.length >= 19 ? `${+ts.slice(8, 10)} ${MONTHS[+ts.slice(5, 7) - 1]} ${ts.slice(0, 4)}, ${ts.slice(11, 16)} UTC` : "–";
const clock = (ts?: string | null) => (typeof ts === "string" && ts.length >= 19 ? ts.slice(11, 19) : "–");
const money = (n?: number | null) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "–");
const num = (n?: number | null) => (typeof n === "number" ? n.toLocaleString("en-IN") : "–");

const L = {
  report: "Incident report", status: "Status", opened: "Opened", resolved: "Resolved", closed: "Closed",
  happened: "What happened", alert: "Alert", playbook: "Playbook", cause: "Cause", none: "None",
  findings: "Findings", source: "Source", submitted: "Submitted",
  timeline: "Timeline", time: "Time (UTC)", actor: "Actor", action: "Action", result: "Result",
  timelineNote: "Audit log entries are shown exactly as recorded.",
  impact: "Business impact", failed: "Orders failed", saved: "Orders saved", atRisk: "At risk per minute", customers: "Customers affected",
  evidence: "Summary of the evidence for the provider", attempts: "Failed attempts", window: "Window",
  closing: "Closing note", noNote: "No closing note was written.", noFindings: "No findings were submitted for this incident.",
  Investigating: "Investigating", Mitigated: "Mitigated", Recovering: "Recovering", Resolved: "Resolved", Closed: "Closed",
  external: "external", internal: "internal",
};

export default async function Report({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }>;
}) {
  const { id } = await params;
  const q = (await searchParams).lang;
  const lang: Lang = isLang(q) ? q : "en";
  const enc = encodeURIComponent(id);
  const [{ data: inc, error }, { data: ev }] = await Promise.all([load<Incident>(`incidents/${enc}`), load<Evidence & { dimension?: string }>(`incidents/${enc}/evidence`)]);

  const f = inc?.findings ?? null;
  const dim = ev?.dimension ?? "value";
  // Our own narrative, written from controller fields only (never a diagnosis of our own).
  const story = inc ? [
    `The ${inc.alert} alert opened this incident on ${date(inc.openedAt)}.`,
    f ? `Findings from ${f.source} were submitted on ${date(f.submittedAt)} and classify the cause as ${f.cause}.` : "",
    inc.playbook ? `The operator approved playbook ${inc.playbook} for ${dim} ${inc.value ?? "–"}, which applied its fallback to that ${dim} only.` : "",
    inc.mitigatedAt ? `The fallback was confirmed on ${date(inc.mitigatedAt)}.` : "",
    inc.resolvedAt ? `Delivery was fully restored on ${date(inc.resolvedAt)}.` : "",
    inc.closedAt ? `The incident was closed on ${date(inc.closedAt)}.` : "",
  ].filter(Boolean) : [];
  const evSentence = ev && typeof ev.failedAttempts === "number"
    ? `Between ${date(ev.from)} and ${date(ev.to)}, ${num(ev.failedAttempts)} delivery attempts failed for ${num(ev.customersAffected)} customers in ${dim} ${ev.value}.` : "";
  const originals = f ? [f.summary, ...(f.evidence ?? [])] : [];
  const close = inc?.closeNote?.trim() ?? "";

  const tr = await translateAll(lang, [...Object.values(L), ...story, evSentence, ...originals, close]);
  const t = (s: string) => tr?.get(s) ?? s;
  const translated = lang !== "en" && !!tr;
  const now = new Date().toISOString();

  const status = inc?.status ?? "";
  const mood: MascotMood = status === "Investigating" ? "alert" : status === "Recovering" ? "working" : status === "Mitigated" ? "calm" : "happy";
  const script = SCRIPT[lang];
  const fonts = `https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;700${script ? `&family=Noto+Sans+${script}:wght@400;500;700` : ""}&display=swap`;

  return (
    <div className="report" lang={translated ? lang : "en"} style={{ "--rfont": `${script ? `"Noto Sans ${script}", ` : ""}"Noto Sans"` } as React.CSSProperties}>
      <link rel="stylesheet" href={fonts} precedence="default" />
      <ReportToolbar id={id} lang={lang} langs={LANGS.map(([c, n]) => [c, n])} />
      {lang !== "en" && !tr && <p className="r-warn" role="status">Translation unavailable, showing English.</p>}

      <article className="sheet">
        <header className="r-head">
          <Mascot mood={mood} size={64} />
          <div>
            <p className="r-brand">FestReady · {t(L.report)}</p>
            <h1><span className="r-id">{id}</span>{inc && <> · {inc.title}</>}</h1>
          </div>
        </header>

        {!inc ? <p className="r-warn">{error ?? "Incident not found."}</p> : <>
          <dl className="r-facts">
            <div><dt>{t(L.status)}</dt><dd>{t((L as Record<string, string>)[status] ?? status)}</dd></div>
            <div><dt>{t(L.opened)}</dt><dd>{date(inc.openedAt)}</dd></div>
            <div><dt>{t(L.resolved)}</dt><dd>{date(inc.resolvedAt)}</dd></div>
            <div><dt>{t(L.closed)}</dt><dd>{date(inc.closedAt)}</dd></div>
          </dl>

          <section>
            <h2>{t(L.happened)}</h2>
            <p className="r-story">{story.map(t).join(" ")}</p>
            <dl className="r-kv">
              <dt>{t(L.alert)}</dt><dd>{inc.alert}</dd>
              <dt>{t(L.playbook)}</dt><dd>{inc.playbook ?? t(L.none)}</dd>
              <dt>{dim}</dt><dd>{inc.value ?? "–"}</dd>
              <dt>{t(L.cause)}</dt><dd>{f ? t((L as Record<string, string>)[f.cause] ?? f.cause) : "–"}</dd>
            </dl>
          </section>

          <section>
            <h2>{t(L.findings)}</h2>
            {f ? <>
              <p className="r-meta">{t(L.source)} <b>{f.source}</b> · {t(L.submitted)} {date(f.submittedAt)}</p>
              <Original label={`Original, as submitted by ${f.source}`}>
                <p className="r-pre">{f.summary}</p>
                {!!f.evidence?.length && <ul>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </Original>
              {translated && <Translation lang={lang}>
                <p className="r-pre">{t(f.summary)}</p>
                {!!f.evidence?.length && <ul>{f.evidence.map((e, i) => <li key={i}>{t(e)}</li>)}</ul>}
              </Translation>}
            </> : <p>{t(L.noFindings)}</p>}
          </section>

          {inc.impact && <section>
            <h2>{t(L.impact)}</h2>
            <dl className="r-figs">
              <div><dt>{t(L.failed)}</dt><dd>{num(inc.impact.ordersFailed)}<small>{money(inc.impact.amountFailed)}</small></dd></div>
              <div><dt>{t(L.saved)}</dt><dd>{num(inc.impact.ordersSaved)}<small>{money(inc.impact.amountSaved)}</small></dd></div>
              <div><dt>{t(L.atRisk)}</dt><dd>{money(inc.impact.atRiskPerMinute)}</dd></div>
              <div><dt>{t(L.customers)}</dt><dd>{num(inc.impact.customersAffected)}</dd></div>
            </dl>
          </section>}

          {evSentence && ev && <section>
            <h2>{t(L.evidence)}</h2>
            <p className="r-story">{t(evSentence)}</p>
            <dl className="r-kv">
              <dt>{t(L.attempts)}</dt><dd>{num(ev.failedAttempts)}</dd>
              <dt>{t(L.customers)}</dt><dd>{num(ev.customersAffected)}</dd>
              <dt>{t(L.window)}</dt><dd>{date(ev.from)} – {clock(ev.to)}</dd>
            </dl>
          </section>}

          <section className="r-timeline">
            <h2>{t(L.timeline)}</h2>
            <p className="r-meta">{t(L.timelineNote)}</p>
            <table>
              <thead><tr><th>{t(L.time)}</th><th>{t(L.actor)}</th><th lang="en">{t(L.action)}</th><th>{t(L.result)}</th></tr></thead>
              <tbody lang="en">
                {(inc.timeline ?? []).map((e, i) => <tr key={i}><td>{clock(e.ts)}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.result}</td></tr>)}
              </tbody>
            </table>
          </section>

          <section>
            <h2>{t(L.closing)}</h2>
            {close ? <>
              <Original label="Original, as written by the operator"><p className="r-pre">{close}</p></Original>
              {translated && <Translation lang={lang}><p className="r-pre">{t(close)}</p></Translation>}
            </> : <p>{t(L.noNote)}</p>}
          </section>
        </>}

        <footer className="r-foot">
          Generated {date(now)} · {translated ? "translation by Sarvam (machine translation)" : "English original"}
        </footer>
      </article>
    </div>
  );
}

const Original = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="r-orig" lang="en"><p className="r-label">{label}</p>{children}</div>
);
const Translation = ({ lang, children }: { lang: string; children: React.ReactNode }) => (
  <div className="r-tr" lang={lang}><p className="r-label" lang="en">Machine translation by Sarvam — original above</p>{children}</div>
);
