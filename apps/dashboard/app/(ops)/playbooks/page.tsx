import { cookies } from "next/headers";
import Playbooks from "@/components/Playbooks";
import { load, paymentDemoEnabled } from "@/lib/server";
import { COOKIE, readSession } from "@/lib/session";
import type { PlaybookRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const defaultOwner = (await readSession((await cookies()).get(COOKIE)?.value)) ?? undefined;
  return <Playbooks initial={await load<PlaybookRow[]>("playbooks")} defaultOwner={defaultOwner} paymentProbeEnabled={paymentDemoEnabled()} />;
}
