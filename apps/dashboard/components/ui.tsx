"use client";
import { useCallback, useEffect, useState } from "react";

export type Loaded<T> = { data?: T; error?: string };

// Poll /api/c/<path> every 2 s. Keeps the last good data when a poll fails, so the page shows stale data + a banner.
export function usePoll<T>(path: string | null, initial?: Loaded<T>, ms = 2000) {
  const [s, set] = useState<Loaded<T>>(initial ?? {});
  const tick = useCallback(async () => {
    if (!path) return;
    try {
      const r = await fetch(`/api/c/${path}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      set((p) => (r.ok ? { data: j } : { data: p.data, error: j?.message || j?.error || `HTTP ${r.status}` }));
    } catch {
      set((p) => ({ data: p.data, error: "Dashboard server unreachable" }));
    }
  }, [path]);
  useEffect(() => {
    if (!path) return;
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [path, ms, tick]);
  return { ...s, reload: tick };
}

export type Result = { ok: boolean; status: number; json: any };

// POST through the server route, which adds X-Admin-Secret. The browser never has it.
export async function post(path: string, body: unknown): Promise<Result> {
  try {
    const r = await fetch(`/api/c/${path}`, { method: "POST", body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, json: { error: "NETWORK", message: "Dashboard server unreachable" } };
  }
}

export const describe = (r: Result) =>
  r.ok ? "done" : `${r.json?.error ?? r.status}${r.json?.message ? `: ${r.json.message}` : ""}${
    r.json?.reasons ? ` (${r.json.reasons.join("; ")})` : ""}`;

// The operator name lives in the nav (localStorage) and goes out as `actor`.
export const operator = () => {
  try { return localStorage.getItem("operator")?.trim() || "operator"; } catch { return "operator"; }
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Shown as the controller sent them (no timezone conversion), so server and browser render identically.
export const fmt = (ts?: string | null) =>
  typeof ts === "string" && ts.length >= 19 ? `${+ts.slice(8, 10)} ${MONTHS[+ts.slice(5, 7) - 1]} ${ts.slice(11, 19)}` : "–";
export const clock = (ts?: string | null) => (typeof ts === "string" && ts.length >= 19 ? ts.slice(11, 19) : "–");
export const money = (n?: number | null) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "–");
export const pct = (v?: number | null, d = 1) => (typeof v === "number" ? `${(v * 100).toFixed(d)}%` : "–"); // v is a fraction 0..1

export const statusKind = (s?: string) =>
  s === "Investigating" ? "bad" : s === "Mitigated" || s === "Recovering" ? "warn" : s === "Resolved" ? "ok" : "";

export function Banner({ error }: { error?: string }) {
  return error ? <div className="banner" role="alert">{error}. Showing the last known data; retrying every 2 s.</div> : null;
}
export const Pill = ({ kind, children }: { kind?: string; children: React.ReactNode }) =>
  <span className={`pill ${kind ?? ""}`}>{children}</span>;

export function Bar({ value, max, bad }: { value: number; max: number; bad?: boolean }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className="bar"><div className={bad ? "bad" : ""} style={{ width: `${w}%` }} /></div>;
}

export type Note = { ok: boolean; text: string } | null;
export const Notice = ({ n }: { n: Note }) =>
  n ? <div className={`notice ${n.ok ? "ok" : "err"}`} role="status">{n.text}</div> : null;

// Runs one write at a time: `busy` names the call in flight so every button can disable itself and say "working…".
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  async function run(label: string, path: string, body: unknown, after?: () => void) {
    setBusy(label);
    setNote(null);
    const r = await post(path, body);
    setNote({ ok: r.ok, text: `${label}: ${describe(r)}` });
    setBusy(null);
    after?.();
    return r;
  }
  return { busy, note, run };
}
// `label` is the action name passed to run(); while that call runs the button reads "working…".
export function Btn({ busy, label, children, disabled, ...p }: { busy: string | null; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} disabled={disabled || !!busy}>{busy === label ? "working…" : children}</button>;
}
