import Overview from "@/components/Overview";
import { load } from "@/lib/server";
import type { IncidentRow, PlaybookRow, State } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [state, incidents, playbooks] = await Promise.all([load<State>("state"), load<IncidentRow[]>("incidents"), load<PlaybookRow[]>("playbooks")]);
  return <Overview state={state} incidents={incidents} playbooks={playbooks} />;
}
