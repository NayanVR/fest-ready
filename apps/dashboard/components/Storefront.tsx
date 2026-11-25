"use client";
import { useCallback, useEffect, useState } from "react";

// Demo shop for the fictional brand "Marigold Lane". Customers are fixed demo IDs (CONTRACTS §2); never 0001, that ID is the controller's probe.
// The city shown is what shop-api returns; the picker labels come from the ID prefix only so they can show before the first response.
const CUSTOMERS = [
  ["cust-mum-0142", "Mumbai"], ["cust-mum-0002", "Mumbai"],
  ["cust-blr-0042", "Bengaluru"], ["cust-blr-0002", "Bengaluru"],
  ["cust-del-0042", "Delhi"], ["cust-del-0002", "Delhi"],
] as const;

const HAMPERS = [
  { id: "diya", name: "Diya & marigold set", price: 799, note: "Twelve clay diyas, a marigold garland, wicks and oil." },
  { id: "mithai", name: "Mithai box", price: 1299, note: "Sixteen pieces: kaju katli, besan ladoo, soan papdi." },
  { id: "grand", name: "The grand hamper", price: 2499, note: "Mithai, diyas, dry fruit, a brass lamp and a handwritten card." },
] as const;

const MODE: Record<string, { name: string; line: string }> = {
  delivery: { name: "Home delivery", line: "A courier brings it to your door." },
  pickup: { name: "Pick up from the store", line: "Collect it from your nearest Marigold Lane counter." },
};
const mode = (o: string) => MODE[o] ?? { name: o, line: "" };
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

type Options = { customerId: string; city: string; options: string[] };
type Result = { ok: boolean; title: string; lines: string[] } | null;

function Art({ id }: { id: string }) {
  // flat drawings in the page palette; no photographs are claimed for this fictional shop
  if (id === "diya") return (
    <svg viewBox="0 0 240 180" aria-hidden>
      <path d="M40 112h160c0 34-34 52-80 52s-80-18-80-52z" fill="#0f2a22" />
      <path d="M120 40c20 22 26 38 14 54-6 8-22 8-28 0-12-16-6-32 14-54z" fill="#f2a900" />
      <path d="M120 66c9 11 11 18 5 26-3 4-8 4-10 0-5-8-3-15 5-26z" fill="#fff" />
      <circle cx="40" cy="146" r="9" fill="#d6336c" /><circle cx="58" cy="154" r="9" fill="#f2a900" /><circle cx="76" cy="160" r="9" fill="#d6336c" />
    </svg>
  );
  if (id === "mithai") return (
    <svg viewBox="0 0 240 180" aria-hidden>
      <rect x="30" y="52" width="180" height="104" fill="#0f2a22" />
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M${54 + i * 40} 70l18 18-18 18-18-18z`} fill="#f2a900" />)}
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={54 + i * 40} cy="132" r="14" fill="#d6336c" />)}
    </svg>
  );
  return (
    <svg viewBox="0 0 240 180" aria-hidden>
      <rect x="22" y="70" width="196" height="92" fill="#0f2a22" />
      <rect x="22" y="70" width="196" height="22" fill="#fff" />
      <rect x="108" y="70" width="24" height="92" fill="#d6336c" />
      <path d="M120 70c-30-40-62-34-52-14 8 14 40 14 52 14zM120 70c30-40 62-34 52-14-8 14-40 14-52 14z" fill="#d6336c" />
      <circle cx="120" cy="66" r="9" fill="#f2a900" />
    </svg>
  );
}

export default function Storefront() {
  const [id, setId] = useState<string>("cust-mum-0142");
  const [opt, setOpt] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hamper, setHamper] = useState<string>(HAMPERS[1].id);
  const [choice, setChoice] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/shop/options?customerId=${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) { setOpt(j); setErr(null); } else setErr(j?.message || j?.error || `HTTP ${r.status}`);
    } catch { setErr("The store could not be reached."); }
  }, [id]);
  useEffect(() => { setOpt(null); refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [refresh]);

  const rawCity = opt?.city ?? CUSTOMERS.find((c) => c[0] === id)?.[1] ?? "";
  const city = rawCity.charAt(0).toUpperCase() + rawCity.slice(1); // shop-api sends it lower-case
  const options = opt?.options ?? [];
  const pick = choice && options.includes(choice) ? choice : options[0] ?? null; // follows the first offered option until the shopper chooses
  const item = HAMPERS.find((h) => h.id === hamper)!;

  async function order() {
    if (!pick) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/shop/orders", { method: "POST", body: JSON.stringify({ customerId: id, mode: pick, amount: item.price, synthetic: false }) });
      const j = await r.json().catch(() => null);
      setResult(r.ok
        ? { ok: true, title: "Order placed", lines: [`${item.name}, ${rupees(j.amount)}`, `${mode(j.mode).name}${j.provider ? ` · courier ${j.provider}` : ""}`, `Order ${j.orderId}`] }
        : { ok: false, title: "We couldn't place this order", lines: [j?.message ?? j?.error ?? `HTTP ${r.status}`, j?.error ? `Code ${j.error}` : ""].filter(Boolean) });
    } catch { setResult({ ok: false, title: "We couldn't place this order", lines: ["The store could not be reached."] }); }
    setBusy(false);
    refresh();
  }

  return (
    <>
      <header className="bar">
        <a href="#top" className="word">Marigold Lane</a>
        <nav aria-label="Store">
          <a href="#hampers">Hampers</a>
          <a href="#checkout">Delivery</a>
        </nav>
        <a className="deliver" href="#checkout">Deliver to <b>{city || "…"}</b> <span>({id})</span></a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>Festive hampers, packed by hand.</h1>
            <p>Mithai, diyas and marigolds for the people you can’t be with this Diwali. Delivered to the door, or ready at the counter.</p>
            <a className="btn solid" href="#hampers">Choose a hamper</a>
          </div>
          <div className="hero-art" aria-hidden><Art id="grand" /></div>
        </section>

        <section className="hampers" id="hampers" aria-labelledby="h-hampers">
          <h2 id="h-hampers">This season’s hampers</h2>
          <div className="hamper-row" role="radiogroup" aria-label="Hamper">
            {HAMPERS.map((h) => (
              <button key={h.id} role="radio" aria-checked={h.id === hamper} className={`hamper ${h.id}`} onClick={() => { setHamper(h.id); setResult(null); }}>
                <span className="art"><Art id={h.id} /></span>
                <span className="name">{h.name}</span>
                <span className="note">{h.note}</span>
                <span className="price">{rupees(h.price)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="checkout" id="checkout" aria-labelledby="h-checkout">
          <div className="co-left">
            <h2 id="h-checkout">Deliver to {city || "…"} <span>({id})</span></h2>
            <p className="lede">Pick a demo customer. What we can offer depends on where they live, and it can change while you shop.</p>
            <div className="who" role="radiogroup" aria-label="Customer">
              {CUSTOMERS.map(([c, name]) => (
                <button key={c} role="radio" aria-checked={c === id} className="who-btn" onClick={() => { setId(c); setChoice(null); setResult(null); }}>
                  <b>{name}</b><span>{c}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="co-right">
            <h3>How would you like it?</h3>
            {err && <p className="alert" role="alert">{err}</p>}
            {!opt && !err && <p className="lede">Checking what we can offer…</p>}
            {opt && options.length === 0 && <p className="alert" role="alert">We can’t offer delivery or pickup to {city} right now.</p>}
            {opt && (
              <div className="modes" role="radiogroup" aria-label="Delivery option">
                {[...new Set([...Object.keys(MODE), ...options])].map((m) => {
                  const on = options.includes(m);
                  return (
                    <button key={m} role="radio" aria-checked={on && pick === m} disabled={!on} className="mode" onClick={() => { setChoice(m); setResult(null); }}>
                      <b>{mode(m).name}</b>
                      <span>{on ? mode(m).line : `Not available in ${city} right now.`}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <button className="btn solid wide" disabled={busy || !pick} onClick={order}>
              {busy ? "Placing your order…" : pick ? `Place order · ${rupees(item.price)} · ${mode(pick).name}` : "Place order"}
            </button>
            <div aria-live="polite">
              {result && (
                <div className={`result ${result.ok ? "ok" : "bad"}`}>
                  <h3>{result.title}</h3>
                  {result.lines.map((l) => <p key={l}>{l}</p>)}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="big" aria-hidden>Marigold Lane</div>
        <p>Marigold Lane is a fictional shop made for the FestReady demo. Nothing here is for sale.</p>
      </footer>
    </>
  );
}
