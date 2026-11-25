import Demo from "@/components/Demo";

export const dynamic = "force-dynamic";

export default function Page() {
  const providers = (process.env.DEMO_PROVIDERS || "a,b,c").split(",").map((s) => s.trim()).filter(Boolean);
  return <Demo providers={providers} />;
}
