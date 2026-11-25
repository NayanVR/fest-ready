"use client";
import { useState } from "react";

export default function Login({ next }: { next?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: f.get("username"), password: f.get("password") }),
      });
      if (r.ok) {
        // only same-site paths; "//host" would be an open redirect
        location.assign(next && /^\/(?![/\\])/.test(next) ? next : "/");
        return;
      }
      setError((await r.json().catch(() => null))?.message ?? `Failed (${r.status})`);
    } catch {
      setError("Dashboard server unreachable.");
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 13h7c4 0 4-7 9-7h4M10 13c4 0 4 7 9 7h4" />
          </svg>
          <span><b>FestReady</b><small>Delivery ops · demo</small></span>
        </div>
        <h1>{signup ? "Create an account" : "Log in"}</h1>
        <div className="seg" role="group" aria-label="Log in or sign up">
          <button type="button" aria-pressed={!signup} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
          <button type="button" aria-pressed={signup} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button>
        </div>
        <label>Username
          <input name="username" required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false}
            aria-describedby={signup ? "u-hint" : undefined} />
          {signup && <small id="u-hint">3–32 characters: a–z, 0–9, dot, dash, underscore.</small>}
        </label>
        <label>Password
          <input name="password" type="password" required minLength={signup ? 4 : undefined}
            autoComplete={signup ? "new-password" : "current-password"} aria-describedby={signup ? "p-hint" : undefined} />
          {signup && <small id="p-hint">At least 4 characters.</small>}
        </label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Log in"}</button>
      </form>
    </div>
  );
}
