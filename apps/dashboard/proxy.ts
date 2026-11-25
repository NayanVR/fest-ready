// Auth gate (Next 16: proxy.ts replaces middleware.ts). Everything needs a valid session except /login, /api/auth/* and /healthz.
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, readSession } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/healthz" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (await readSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Log in at /login first." }, { status: 401 });
  const to = new URL("/login", req.url);
  to.searchParams.set("next", pathname + search);
  return NextResponse.redirect(to);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
