"use client";
import { useCallback, useEffect, useState } from "react";
import { Notice, Pill, type Note } from "./ui";

// Fixed demo customers (CONTRACTS §2). Never 0001: that ID is the controller's probe. The city comes back from shop-api.
const DEMO_IDS = ["cust-blr-0002", "cust-blr-0042", "cust-mum-0002", "cust-mum-0142", "cust-del-0002", "cust-del-0042"];

type Options = { customerId: string; city: string; options: string[]; flags?: Record<string, boolean> };

export default function Storefront() {
  const [id, setId] = useState(DEMO_IDS[0]);
  const [opt, setOpt] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState(1000);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/shop/options?customerId=${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) { setOpt(j); setErr(null); } else setErr(j?.message || j?.error || `HTTP ${r.status}`);
    } catch { setErr("Dashboard server unreachable"); }
  }, [id]);
  useEffect(() => { setOpt(null); refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [refresh]);

  async function order(mode: string) {
    setBusy(mode); setNote(null);
    try {
      const r = await fetch("/api/shop/orders", { method: "POST", body: JSON.stringify({ customerId: id, mode, amount, synthetic: false }) });
      const j = await r.json().catch(() => null);
      setNote({
        ok: r.ok,
        text: r.ok ? `Order ${j.orderId} placed: ${j.mode}${j.provider ? `, provider ${j.provider}` : ""}, ₹${j.amount.toLocaleString("en-IN")}`
                   : `${j?.message ?? j?.error ?? `HTTP ${r.status}`}${j?.error ? ` [${j.error}]` : ""}`,
      });
    } catch { setNote({ ok: false, text: "Dashboard server unreachable" }); }
    setBusy(null);
    refresh();
  }

  return (
    <>
      <div className="titlerow"><h1>Storefront</h1></div>
      <p className="sub">Pick a demo customer and check out the way a shopper would. The options shown are what shop-api returns right now.</p>
      <div className="cols eq" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)" }}>
        <section className="card">
          <div className="cardhead"><h2>Customer</h2></div>
          <div className="chips" role="group" aria-label="Demo customers">
            {DEMO_IDS.map((d) => <button key={d} className={`id-sel ${d === id ? "sel" : ""}`} aria-pressed={d === id} onClick={() => { setId(d); setNote(null); }}>{d}</button>)}
          </div>
        </section>
        <section className="card">
          <div className="cardhead"><h2>Checkout</h2>{opt && <span className="muted">{opt.city}</span>}</div>
          {err && <div className="banner" role="alert">{err}</div>}
          {!opt && !err && <div className="muted">Loading options…</div>}
          {opt && (
            <>
              <div className="row" style={{ marginBottom: 14 }}>
                <span className="muted">Offered:</span>
                {opt.options.map((o) => <Pill key={o} kind="ok">{o}</Pill>)}
                {opt.options.length === 0 && <span className="muted">no options</span>}
              </div>
              <label style={{ maxWidth: 220 }}>Amount (₹)
                <input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </label>
              <div className="actions">
                {opt.options.map((o, i) => (
                  <button key={o} className={i === 0 ? "primary" : ""} disabled={!!busy || !(amount >= 1)} onClick={() => order(o)}>{busy === o ? "working…" : `Order for ${o}`}</button>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 12 }}><Notice n={note} /></div>
        </section>
      </div>
    </>
  );
}
