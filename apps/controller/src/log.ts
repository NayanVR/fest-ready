// One JSON line per event on stdout (CONTRACTS.md §4 logs).
export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "controller", level, msg, ...extra }));
}
