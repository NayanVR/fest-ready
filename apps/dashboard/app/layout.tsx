// Root: html shell only. Each portal (ops, login, store, presenter) imports its own CSS in its layout.
export const metadata = { title: "FestReady ops" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,500;9..144,700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
