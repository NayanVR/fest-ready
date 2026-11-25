import "../globals.css";
import { cookies } from "next/headers";
import Nav from "@/components/Nav";
import { COOKIE, readSession } from "@/lib/session";
import { paymentDemoEnabled } from "@/lib/server";

export const metadata = { title: "FestReady ops" };

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const user = (await readSession((await cookies()).get(COOKIE)?.value)) ?? undefined;
  return (
    <div className="shell">
      <Nav user={user} paymentDemo={paymentDemoEnabled()} />
      <main className="canvas">{children}</main>
    </div>
  );
}
