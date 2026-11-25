// Storefront → shop-api proxy (SHOP_URL is server-side only; in the cluster the browser can't reach it).
import { NextRequest } from "next/server";
import { shopUrl } from "@/lib/server";

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!(req.method === "GET" && path === "options") && !(req.method === "POST" && path === "orders"))
    return Response.json({ error: "NOT_ALLOWED", message: `${req.method} /api/${path} is not proxied` }, { status: 404 });
  try {
    const r = await fetch(`${shopUrl()}/api/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: req.method === "POST" ? { "content-type": "application/json" } : {},
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "SHOP_DOWN", message: `shop-api unreachable at ${shopUrl()}` }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST };
