// Playbook assistant: system prompt and JSON extraction for Sarvam chat replies. Pure (no network), so it is testable.
export type Msg = { role: "user" | "assistant"; content: string };
export type Answer = { reply: string; draft: Record<string, unknown> | null; questions: string[] };
export type Context = { playbooks: unknown[]; flags: string[]; eventFields: string[]; labelValues?: Record<string, string[]>; unavailable: string[] };

const SCHEMA = `Playbook JSON shape (all fields required unless marked optional):
{
  "id": "lowercase-hyphen-id", "owner": "team-name",
  "description": "What fails, for which dimension value, and what the fallback does. Written for an investigation agent.",
  "match": { "alerts": ["AlertName"], "cause": "external" | "internal" },
  "dimension": { "name": "...", "trait": "Flagsmith trait", "label": "Prometheus label", "values": ["v1","v2"] },
  "flag": { "key": "existing Flagsmith flag", "normal": {"enabled": true, "value"?: string|number}, "fallback": {"enabled": false, "value"?: string|number} },
  "segments": { "fallback": "{value}-fallback", "recovery": "{value}-recovery" },
  "recovery": { "method": "split", "steps": [5,10,50,100],
    "guardrail": { "min_samples": 10, "max_error_rate": 0.05, "max_consecutive_errors": 3, "window": "20s" },
    "cooldown_after_rollback": "60s", "auto_advance": true },
  "events": { "dimension_field": "...", "identity_field": "...", "outcome_field": "...", "amount_field"?: "...", "canary_filter"?: { "field": "value" } },
  "probe": { "every": "10s", "healthy_for": "60s", "identities": { "<each value>": "<a customer id for that value>" },
    "request": { "method": "POST", "url": "\${SHOP_URL}/api/orders" or "\${SHOP_URL}/api/payments", "body": { "customerId": "{probe_identity}", ... } },
    "expect": { "healthy": {"status": 201}, "fallback_active": {"status": 409} } }
}`;

const RULES = `Platform rules (a draft breaking any of these is rejected):
- id matches ^[a-z0-9-]+$. dimension.values non-empty and unique. probe.identities has exactly one entry per value.
- flag.normal and flag.fallback must differ. segments.fallback and segments.recovery both contain {value} and differ.
- recovery.method is "split". steps strictly increasing, first <= 10, last = 100.
- guardrail.min_samples >= 10; 0 < max_error_rate <= 0.2; max_consecutive_errors >= 1. Durations look like "20s", "2m".
- Placeholders allowed: only {value}, {probe_identity} and \${ENV_VAR}. No \${...} inside probe.request.body or segments.
- probe.request must POST to \${SHOP_URL}/api/orders or \${SHOP_URL}/api/payments.
Safe defaults unless the user asks otherwise: min_samples 10, max_error_rate 0.05, max_consecutive_errors 3, window 20s,
cooldown 60s, steps [5,10,50,100], auto_advance true, probe every 10s healthy_for 60s, segments "{value}-fallback" / "{value}-recovery".`;

export function systemPrompt(c: Context, draft?: unknown): string {
  const live = [
    `Flagsmith flags that exist: ${c.flags.length ? c.flags.join(", ") : "(none found)"}`,
    `Fields seen in recent order/payment events: ${c.eventFields.length ? c.eventFields.join(", ") : "(none seen)"}`,
    ...Object.entries(c.labelValues ?? {}).map(([k, v]) => `Observed values of ${k}: ${v.join(", ")}`),
    c.unavailable.length ? `Could not load: ${c.unavailable.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  return `You help an operator write a resilience playbook for FestReady. When one value of a dimension (a region, a bank, a store...) fails because of a dependency, the playbook moves only that value's customers to a fallback through a feature flag, then brings them back in guarded canary steps.

${SCHEMA}

${RULES}

LIVE DATA (use these exact names; never invent a flag or event field that is not listed; if nothing fits, say so and ask; a flag whose name clearly belongs to a different feature is not a fit, so name the flag the operator must create in Flagsmith instead and say readiness will fail until it exists):
${live}

Existing playbooks (examples of valid playbooks; do not reuse an existing id):
${JSON.stringify(c.playbooks)}
${draft ? `\nThe operator's current draft (edit it rather than starting over):\n${JSON.stringify(draft)}\n` : ""}
Answer with ONE JSON object and nothing else:
{"reply": "short plain-English explanation of what you drafted or changed", "draft": <the FULL playbook object, or null if you need answers first>, "questions": ["optional questions about things you could not decide from the data"]}`;
}

// Pull the first balanced JSON object out of a model reply (handles leading whitespace, ``` fences, prose around it).
export function extractJson(text: string): unknown {
  const s = text.replace(/```(?:json)?/gi, "");
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

// Normalise to {reply, draft, questions}; null when the reply has no usable JSON.
export function parseAnswer(text: string): Answer | null {
  const j = extractJson(text) as any;
  if (!j || typeof j !== "object") return null;
  const isObj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
  // The model sometimes returns the bare playbook instead of the envelope.
  if (!("reply" in j) && !("draft" in j) && typeof j.id === "string") return { reply: "Here is a draft.", draft: j, questions: [] };
  if (typeof j.reply !== "string" && !isObj(j.draft)) return null;
  return {
    reply: typeof j.reply === "string" ? j.reply : "",
    draft: isObj(j.draft) ? j.draft : null,
    questions: Array.isArray(j.questions) ? j.questions.filter((q: unknown): q is string => typeof q === "string") : [],
  };
}
