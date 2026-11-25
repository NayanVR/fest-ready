import Playbooks from "@/components/Playbooks";
import { load } from "@/lib/server";
import type { PlaybookRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Playbooks initial={await load<PlaybookRow[]>("playbooks")} />;
}
