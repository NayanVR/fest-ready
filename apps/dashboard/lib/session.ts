// Signed session cookie: `<username>.<expiry unix s>.<hex HMAC-SHA256>`, keyed by ADMIN_SECRET (server-only).
// Web Crypto only, so it also runs in proxy.ts.
export const COOKIE = "fr_session";
export const TTL = 12 * 3600; // seconds

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const key = (usage: "sign" | "verify") => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET is not set");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
};

export async function signSession(user: string): Promise<string> {
  const body = `${user}.${Math.floor(Date.now() / 1000) + TTL}`;
  return `${body}.${hex(await crypto.subtle.sign("HMAC", await key("sign"), enc.encode(body)))}`;
}

/** The username if the token is signed by us and not expired, else null. */
export async function readSession(token?: string): Promise<string | null> {
  try {
    const m = token?.match(/^(.+)\.(\d+)\.([0-9a-f]{64})$/);
    if (!m || +m[2] < Date.now() / 1000) return null;
    const ok = await crypto.subtle.verify("HMAC", await key("verify"), unhex(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    return ok ? m[1] : null;
  } catch {
    return null;
  }
}
