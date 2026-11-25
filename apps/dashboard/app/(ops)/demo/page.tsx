import Demo from "@/components/Demo";
import PaymentSimulation from "@/components/PaymentSimulation";
import { paymentDemoEnabled } from "@/lib/server";

export const dynamic = "force-dynamic";

// Demo controls inside the ops console: simulate a provider outage, then watch the console recover it.
export default function Page() {
  const providers = (process.env.DEMO_PROVIDERS || "a,b,c").split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <>
      <div className="titlerow"><h1>Demo controls</h1><span className="muted">Simulated failures for the demo</span></div>
      <section className="card">
        <div className="cardhead"><h2>Courier provider outage</h2></div>
        <p className="muted">Starts or clears an outage in the partner mock. Nothing here knows which city a provider serves.</p>
        <Demo providers={providers} />
      </section>
      {paymentDemoEnabled() && (
        <section className="card">
          <div className="cardhead"><h2>Payment simulation</h2></div>
          <PaymentSimulation />
        </section>
      )}
    </>
  );
}
