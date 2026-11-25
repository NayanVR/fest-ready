import "./globals.css";
import Nav from "@/components/Nav";

export const metadata = { title: "Festive Rush ops" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="shell">
          <Nav />
          <main className="canvas">{children}</main>
        </div>
      </body>
    </html>
  );
}
