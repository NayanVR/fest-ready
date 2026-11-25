// Playbook assistant (server only). Behind the login gate in proxy.ts. SARVAM_API_KEY and ADMIN_SECRET never leave the server.
// It only drafts: discovery and the readiness dry-run are read-only, and nothing is ever saved from here.
import { NextRequest } from "next/server";
import { controllerUrl } from "@/lib/server";
import { parseAnswer, systemPrompt, type Context, type Msg } from "@/lib/assistant";

const TIMEOUT = 60_000;
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status });

async function controller(path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${controllerUrl()}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json", "x-admin-secret": process.env.ADMIN_SECRET ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: r.ok, json: await r.json().catch(() => null) };
}

// Live names for the prompt. Each source is optional; failures are listed so the model knows what it could not see.
async function context(): Promise<Context> {
  const unavailable: string[] = [];
  const get = async <T,>(name: string, f: () => Promise<T>, empty: T) => {
    try { return await f(); } catch { unavailable.push(name); return empty; }
  };
  const [playbooks, flags, eventFields] = await Promise.all([
    get("playbooks", async () => { const r = await controller("playbooks"); if (!r.ok) throw 0; return r.json as any[]; }, []),
    // Flag search needs a term; a few common characters cover typical snake/kebab-case keys.
    get("Flagsmith flags", async () => {
      const rs = await Promise.all(["_", "-", "e", "a"].map((search) => controller("playbook-wizard/flags", { search })));
      if (!rs.some((r) => r.ok)) throw 0;
      return [...new Set(rs.flatMap((r) => (r.ok && Array.isArray(r.json?.flags) ? r.json.flags : [])))] as string[];
    }, [] as string[]),
    get("event fields", async () => { const r = await controller("playbook-wizard/event-fields", {}); if (!r.ok) throw 0; return r.json.fields as string[]; }, [] as string[]),
  ]);
  const labelValues: Record<string, string[]> = {};
  for (const label of [...new Set(playbooks.map((p) => p?.dimension?.label).filter((l) => typeof l === "string"))] as string[]) {
    const r = await controller("playbook-wizard/label-values", { label }).catch(() => null);
    if (r?.ok && Array.isArray(r.json?.values)) labelValues[label] = r.json.values;
    else if (!unavailable.includes("Prometheus label values")) unavailable.push("Prometheus label values");
  }
  return { playbooks, flags, eventFields, labelValues, unavailable };
}

async function sarvam(messages: { role: string; content: string }[], deadline: number): Promise<string> {
  const r = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "api-subscription-key": process.env.SARVAM_API_KEY! },
    body: JSON.stringify({ model: "sarvam-105b", max_tokens: 8000, messages }),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  const j = await r.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content;
  if (!r.ok || typeof content !== "string") throw new Error(`Sarvam returned ${r.status}`);
  return content;
}

export async function POST(req: NextRequest) {
  if (!process.env.SARVAM_API_KEY) return fail(503, "ASSISTANT_UNCONFIGURED", "SARVAM_API_KEY is not set on the dashboard server.");
  const body = await req.json().catch(() => null);
  const msgs = body?.messages;
  if (!Array.isArray(msgs) || !msgs.length || msgs.length > 40 ||
      !msgs.every((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.length <= 8000))
    return fail(400, "BAD_REQUEST", "messages must be 1–40 {role: user|assistant, content} items");
  const draft = body.draft && typeof body.draft === "object" && !Array.isArray(body.draft) ? body.draft : undefined;

  const deadline = Date.now() + TIMEOUT;
  const convo = [{ role: "system", content: systemPrompt(await context(), draft) }, ...(msgs as Msg[])];
  let answer;
  try {
    const first = await sarvam(convo, deadline);
    answer = parseAnswer(first);
    if (!answer) answer = parseAnswer(await sarvam([...convo, { role: "assistant", content: first },
      { role: "user", content: 'Return valid JSON only: {"reply": string, "draft": object|null, "questions": string[]}. No other text.' }], deadline));
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return fail(502, "ASSISTANT_FAILED", timeout ? "Sarvam did not answer within 60 s. Try again." : `Sarvam request failed (${e instanceof Error ? e.message : "error"}).`);
  }
  if (!answer) return fail(502, "ASSISTANT_FAILED", "Sarvam did not return a usable answer. Try rephrasing.");

  let readiness = null;
  if (answer.draft) {
    const r = await controller("playbook-wizard/readiness", answer.draft).catch(() => null);
    readiness = !r ? { readiness: "unknown", reasons: ["Controller unreachable for the readiness check"] }
      : r.ok ? { readiness: r.json.readiness, reasons: r.json.reasons ?? [] }
      : { readiness: "invalid", reasons: r.json?.reasons ?? [r.json?.message ?? `Readiness check returned an error`] };
  }
  return Response.json({ reply: answer.reply, draft: answer.draft, readiness, questions: answer.questions });
}
