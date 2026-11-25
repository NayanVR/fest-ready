// Browser → controller proxy. The only place ADMIN_SECRET is used; it is added to writes server-side.
import { NextRequest } from "next/server";
import { controllerUrl } from "@/lib/server";

const ID = "[A-Za-z0-9-]+";
const ALLOWED: [string, RegExp][] = [
  ["GET", /^(state|incidents|playbooks|audit)$/],
  ["GET", new RegExp(`^(incidents|playbooks)/${ID}$`)],
  ["GET", new RegExp(`^incidents/${ID}/evidence$`)],
  ["POST", new RegExp(`^incidents/${ID}/(ack|findings|approve|advance|rollback|close)$`)],
  ["POST", new RegExp(`^playbooks/${ID}/check$`)],
  ["POST", /^fault$/],
];

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(path)))
    return Response.json({ error: "NOT_ALLOWED", message: `${req.method} /api/${path} is not proxied` }, { status: 404 });

  const headers: Record<string, string> = {};
  if (req.method === "POST") {
    headers["content-type"] = "application/json";
    headers["x-admin-secret"] = process.env.ADMIN_SECRET ?? "";
  }
  try {
    const r = await fetch(`${controllerUrl()}/api/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      // approve/advance/rollback make several Flagsmith calls (~30 s seen)
      signal: AbortSignal.timeout(60000),
    });
    const out = new Headers();
    for (const h of ["content-type", "content-disposition"]) if (r.headers.has(h)) out.set(h, r.headers.get(h)!);
    return new Response(r.body, { status: r.status, headers: out });
  } catch {
    return Response.json(
      { error: "CONTROLLER_DOWN", message: `Controller unreachable at ${controllerUrl()}` },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST };
