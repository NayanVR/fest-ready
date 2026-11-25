import Playbooks from "@/components/Playbooks";
import { paymentTemplate } from "@/lib/payment-template";
import { load, paymentDemoEnabled } from "@/lib/server";
import type { PlaybookRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Playbooks initial={await load<PlaybookRow[]>("playbooks")} template={paymentDemoEnabled() ? paymentTemplate : undefined} />;
}
