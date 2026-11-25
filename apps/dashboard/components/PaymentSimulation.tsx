"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Notice, Pill } from "./ui";

type Provider = { id: string; available: boolean };
type PaymentResult = {
  paymentId?: string;
  preferredProvider?: string;
  provider?: string;
  route?: "primary" | "fallback";
  message?: string;
  error?: string;
};

async function paymentRequest<T>(path: string, body?: object): Promise<{ ok: boolean; data: T & PaymentResult }> {
  const response = await fetch(`/api/shop/payments${path}`, {
    method: body ? "POST" : "GET",
    body: body && JSON.stringify(body),
    cache: "no-store",
  });
  return { ok: response.ok, data: await response.json() };
}

export default function PaymentSimulation() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("");
  const [customerId, setCustomerId] = useState("pay-demo-0001");
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState("loading");
  const [statusError, setStatusError] = useState("");
  const [outageNote, setOutageNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; data: PaymentResult }>();

  async function loadProviders() {
    setStatusError("");
    try {
      const { ok, data } = await paymentRequest<{ providers: Provider[] }>("/demo");
      if (!ok || !Array.isArray(data.providers)) throw new Error(data.message || "Provider status is unavailable.");
      setProviders(data.providers);
      setProvider((current) => data.providers.some((p) => p.id === current) ? current : (data.providers[0]?.id ?? ""));
    } catch (error) {
      setStatusError((error as Error).message);
    }
  }

  useEffect(() => {
    void loadProviders().finally(() => setBusy(""));
  }, []);

  async function changeOutage(p: Provider) {
    setBusy(p.id);
    setOutageNote("");
    setStatusError("");
    try {
      const { ok, data } = await paymentRequest("/demo/outage", { provider: p.id, status: p.available ? 503 : null });
      if (!ok) throw new Error(data.message || "Could not update the simulated outage.");
      setOutageNote(p.available ? `Simulated outage started for ${p.id}.` : `Outage cleared for ${p.id}.`);
    } catch (error) {
      setStatusError((error as Error).message);
      setBusy("");
      return;
    }
    await loadProviders();
    setBusy("");
  }

  async function runPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !provider) return;
    setBusy("payment");
    setResult(undefined);
    try {
      const { ok, data } = await paymentRequest("", { customerId, provider, amount: Number(amount), synthetic: true });
      setResult({ ok, data: { ...data, preferredProvider: data.preferredProvider ?? provider } });
    } catch {
      setResult({ ok: false, data: { preferredProvider: provider, message: "Could not reach the payment simulation." } });
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="payment-providers">
        <div className="cardhead"><h2 id="payment-providers">Mock providers</h2></div>
        {statusError && <div className="notice err" role="alert">{statusError} <button className="link" type="button" disabled={!!busy}
          onClick={() => { setBusy("loading"); void loadProviders().finally(() => setBusy("")); }}>Refresh provider status</button></div>}
        {busy === "loading" && <p className="muted" role="status">Loading provider status…</p>}
        {!busy && !statusError && providers.length === 0 && <p className="muted">No mock providers are available.</p>}
        <ul className="payment-providers">
          {providers.map((p) => (
            <li key={p.id}>
              <div className="row">
                <strong>Provider {p.id}</strong>
                <Pill kind={p.available ? "ok" : "bad"}>{p.available ? "Available" : "Outage"}</Pill>
              </div>
              <button className={p.available ? "danger" : undefined} type="button" disabled={!!busy || !!statusError}
                aria-label={`${p.available ? "Simulate outage for" : "Clear outage for"} provider ${p.id}`}
                onClick={() => void changeOutage(p)}>
                {p.available ? "Simulate outage" : "Clear outage"}
              </button>
            </li>
          ))}
        </ul>
        <Notice n={outageNote ? { ok: true, text: outageNote } : null} />
      </section>
      <div className="cols eq payment-cards">
        <section className="card" aria-labelledby="payment-test">
          <h2 id="payment-test">Test payment</h2>
          <form className="form" onSubmit={runPayment}>
            <label>Preferred provider
              <select required value={provider} onChange={(event) => setProvider(event.target.value)}>
                {providers.length === 0 && <option value="">Choose a provider</option>}
                {providers.map((p) => <option value={p.id} key={p.id}>{p.id}</option>)}
              </select>
            </label>
            <div className="payment-customer">
              <label>Synthetic customer
                <input className="mono" readOnly value={customerId} />
              </label>
              <button type="button" disabled={!!busy} onClick={() => setCustomerId(`pay-demo-${crypto.randomUUID().slice(0, 13)}`)}>Generate customer</button>
            </div>
            <label>Test amount (₹)
              <input type="number" required min={1} max={100000} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <div><button className="primary" type="submit" disabled={!!busy || !provider}>
              {busy === "payment" ? "Running test payment…" : "Run test payment"}
            </button></div>
          </form>
        </section>
        <section className="card" aria-labelledby="payment-result">
          <h2 id="payment-result">Payment result</h2>
          <div aria-live="polite">
            {result ? (
              <>
                <Pill kind={result.ok ? "ok" : "bad"}>{result.ok ? "Payment succeeded" : "Payment failed"}</Pill>
                <dl className="kv">
                  <dt>Preferred provider</dt><dd>{result.data.preferredProvider ?? "–"}</dd>
                  <dt>{result.ok ? "Actual provider" : "Attempted provider"}</dt><dd>{result.data.provider ?? "–"}</dd>
                  <dt>Routing path</dt><dd>{result.data.route === "primary" ? "Primary" : result.data.route === "fallback" ? "Fallback" : "–"}</dd>
                  {result.data.paymentId && <><dt>Payment ID</dt><dd><code>{result.data.paymentId}</code></dd></>}
                </dl>
                {!result.ok && (
                  <>
                    <p className="muted">{result.data.message || result.data.error || "Payment could not be completed."}</p>
                    <p className="payment-incident-link"><Link href="/">View incidents in Overview</Link></p>
                    <p className="muted">Use the operator findings form for payment incidents.</p>
                  </>
                )}
              </>
            ) : <p className="muted">{busy === "payment" ? "Waiting for the payment response…" : "Run a test payment to see which provider handled it."}</p>}
          </div>
        </section>
      </div>
    </>
  );
}
