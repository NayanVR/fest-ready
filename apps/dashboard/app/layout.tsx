import "./globals.css";
import { cookies } from "next/headers";
import Nav from "@/components/Nav";
import { COOKIE, readSession } from "@/lib/session";

export const metadata = { title: "FestReady ops" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = (await readSession((await cookies()).get(COOKIE)?.value)) ?? undefined;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="shell">
          <Nav user={user} />
          <main className="canvas">{children}</main>
        </div>
      </body>
    </html>
  );
}
