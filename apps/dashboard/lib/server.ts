// Server-only helpers. ADMIN_SECRET is read here and in app/api/c only.
export const controllerUrl = () => process.env.CONTROLLER_URL || "http://localhost:4100";
export const shopUrl = () => process.env.SHOP_URL || "http://localhost:4001";

export type Loaded<T> = { data?: T; error?: string };

// First paint for a page: fetch from the controller on the server, never throw.
export async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    const r = await fetch(`${controllerUrl()}/api/${path}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { error: j?.message || j?.error || `Controller returned ${r.status}` };
    return { data: j as T };
  } catch {
    return { error: `Controller unreachable at ${controllerUrl()}` };
  }
}
