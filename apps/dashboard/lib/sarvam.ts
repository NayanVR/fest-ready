// Server-only: Sarvam machine translation for the incident report. SARVAM_API_KEY never leaves the server.
export const LANGS = [
  ["en", "English"], ["hi", "हिन्दी"], ["mr", "मराठी"], ["kn", "ಕನ್ನಡ"],
  ["ta", "தமிழ்"], ["te", "తెలుగు"], ["bn", "বাংলা"], ["gu", "ગુજરાતી"],
] as const;
export type Lang = (typeof LANGS)[number][0];
export const isLang = (s?: string): s is Lang => LANGS.some(([c]) => c === s);

const cache = new Map<string, string>(); // `${lang}\0${text}` → translation; only successes are kept

// Sarvam takes at most 2000 characters per call; split on sentence ends (then spaces) into pieces ≤ max.
export function chunk(text: string, max = 1800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of text.match(/[^.!?\n]+[.!?\n]*\s*/g) ?? [text]) {
    for (let piece = s; piece; ) {
      const room = max - cur.length;
      if (piece.length <= room) { cur += piece; piece = ""; continue; }
      if (cur) { out.push(cur); cur = ""; continue; }
      const cut = piece.lastIndexOf(" ", max) > 0 ? piece.lastIndexOf(" ", max) + 1 : max; // one sentence longer than max
      out.push(piece.slice(0, cut)); piece = piece.slice(cut);
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function call(lang: Lang, input: string): Promise<string> {
  const r = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: { "content-type": "application/json", "api-subscription-key": process.env.SARVAM_API_KEY! },
    body: JSON.stringify({ input, source_language_code: "en-IN", target_language_code: `${lang}-IN`, model: "sarvam-translate:v1" }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || typeof j?.translated_text !== "string") throw new Error(`Sarvam ${r.status}`);
  return j.translated_text;
}

async function one(lang: Lang, text: string): Promise<string> {
  const k = `${lang}\0${text}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const parts = [];
  for (const p of chunk(text)) parts.push(p.trim() ? await call(lang, p.trim()) : p);
  const t = parts.join(" ");
  cache.set(k, t);
  return t;
}

// Translate every string, at most 4 calls in flight. Any failure (or no key) → null, and the caller shows English.
export async function translateAll(lang: Lang, texts: string[]): Promise<Map<string, string> | null> {
  const todo = [...new Set(texts.filter((t) => t.trim()))];
  if (lang === "en" || !todo.length) return new Map();
  if (!process.env.SARVAM_API_KEY) return null;
  const out = new Map<string, string>();
  let i = 0, failed = false;
  const worker = async () => {
    while (i < todo.length && !failed) {
      const t = todo[i++]!;
      try { out.set(t, await one(lang, t)); } catch { failed = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  return failed ? null : out;
}
