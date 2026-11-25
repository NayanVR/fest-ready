import Incident from "@/components/Incident";
import { load } from "@/lib/server";
import type { Incident as Inc } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Incident id={id} initial={await load<Inc>(`incidents/${encodeURIComponent(id)}`)} />;
}
