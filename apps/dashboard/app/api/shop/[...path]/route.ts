// Dashboard → shop-api proxy. The outage switch uses the server's admin secret.
import { NextRequest } from "next/server";
import { paymentDemoEnabled, shopUrl } from "@/lib/server";

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const path = parts.join("/");
  const get = req.method === "GET";
  const post = req.method === "POST";
  const storefront = (get && path === "options") || (post && path === "orders");
  const outage = post && path === "payments/demo/outage";
  const payment = paymentDemoEnabled() && parts.every((part) => !part.includes("/")) &&
    ((get && path === "payments/demo") || (post && path === "payments") || outage);
  if (!storefront && !payment)
    return Response.json({ error: "NOT_ALLOWED", message: `${req.method} /api/${path} is not proxied` }, { status: 404 });

  const headers: Record<string, string> = post ? { "content-type": "application/json" } : {};
  if (outage) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) return Response.json({ error: "NOT_CONFIGURED", message: "Outage controls are unavailable." }, { status: 503 });
    headers["x-admin-secret"] = secret;
  }
  try {
    const r = await fetch(`${shopUrl()}/api/${path}${storefront ? req.nextUrl.search : ""}`, {
      method: req.method,
      headers,
      body: post ? await req.text() : undefined,
      cache: "no-store",
      // Payment routing can query the fixture and try two alternate providers in sequence.
      signal: AbortSignal.timeout(payment ? 8000 : 5000),
      redirect: payment ? "error" : "follow",
    });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "SHOP_DOWN", message: `shop-api unreachable at ${shopUrl()}` }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST };
