import Demo from "@/components/Demo";
import Mascot from "@/components/Mascot";
import PaymentSimulation from "@/components/PaymentSimulation";
import { paymentDemoEnabled } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Page() {
  const providers = (process.env.DEMO_PROVIDERS || "a,b,c").split(",").map((s) => s.trim()).filter(Boolean);
  const payments = paymentDemoEnabled();
  return (
    <>
      <header className="pres-bar">
        <Mascot mood="happy" size={56} />
        <div>
          <h1>Presenter control room</h1>
          <p>Break things on purpose, then show the ops console recovering them.</p>
        </div>
        <span className="demo-badge">DEMO</span>
        <nav aria-label="Demo portals">
          <a href="/store" target="_blank" rel="noreferrer">Storefront ↗</a>
          <a href="/" target="_blank" rel="noreferrer">Ops console ↗</a>
        </nav>
      </header>
      <main className={`pres-main ${payments ? "two" : ""}`}>
        <section aria-labelledby="p-outage">
          <h2 id="p-outage">Courier provider outage</h2>
          <p className="hint">Starts or clears a provider outage in the partner mock. Nothing here knows which city a provider serves.</p>
          <Demo providers={providers} />
        </section>
        {payments && (
          <section aria-labelledby="p-pay">
            <h2 id="p-pay">Payment simulation</h2>
            <p className="hint">Simulate a payment provider outage and test routing with a synthetic customer.</p>
            <PaymentSimulation />
          </section>
        )}
      </main>
    </>
  );
}
