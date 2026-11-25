import Audit from "@/components/Audit";
import { load } from "@/lib/server";
import type { AuditRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Audit initial={await load<AuditRow[]>("audit")} />;
}
