// login / signup / logout. Users are in lib/auth.ts, the cookie is signed in lib/session.ts.
import { NextRequest, NextResponse } from "next/server";
import { checkLogin, signup } from "@/lib/auth";
import { COOKIE, TTL, signSession } from "@/lib/session";

const fail = (error: string, message: string, status: number) => NextResponse.json({ error, message }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  }
  if (action !== "login" && action !== "signup") return fail("NOT_FOUND", `No such action: ${action}`, 404);
  if (!process.env.ADMIN_SECRET) return fail("NOT_CONFIGURED", "ADMIN_SECRET is not set on the dashboard server.", 500);

  const b = await req.json().catch(() => null);
  const name = typeof b?.username === "string" ? b.username.trim().toLowerCase() : "";
  const password = typeof b?.password === "string" ? b.password : "";
  if (action === "signup") {
    const msg = await signup(name, password);
    if (msg) return fail("INVALID", msg, msg.endsWith("taken.") ? 409 : 400);
  } else if (!(await checkLogin(name, password))) {
    return fail("BAD_LOGIN", "Wrong username or password.", 401);
  }
  const res = NextResponse.json({ ok: true, username: name });
  res.cookies.set(COOKIE, await signSession(name), { httpOnly: true, sameSite: "lax", path: "/", maxAge: TTL });
  return res;
}
