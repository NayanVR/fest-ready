import { notFound } from "next/navigation";
import PaymentSimulation from "@/components/PaymentSimulation";
import { paymentDemoEnabled } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!paymentDemoEnabled()) notFound();
  return <PaymentSimulation />;
}
