"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconAudit, IconDemo, IconExternal, IconLogout, IconOverview, IconPlaybooks, IconStore } from "./icons";

const LINKS = [["/", "Overview", IconOverview], ["/playbooks", "Playbooks", IconPlaybooks], ["/audit", "Audit log", IconAudit]] as const;
const TOOLS = [["/demo", "Demo controls", IconDemo]] as const;

export default function Nav({ user, paymentDemo }: { user?: string; paymentDemo: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); location.assign("/login"); };
  const item = ([href, label, Icon]: readonly [string, string, typeof IconOverview]) => {
    const on = href === "/" ? path === "/" || path.startsWith("/incidents") : path.startsWith(href);
    return <Link key={href} href={href} aria-current={on ? "page" : undefined}><Icon />{label}</Link>;
  };
  return (
    <aside className="side">
      <Link href="/" className="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 13h7c4 0 4-7 9-7h4M10 13c4 0 4 7 9 7h4" />
        </svg>
        <span><b>FestReady</b><small>Delivery ops · demo</small></span>
      </Link>
      <button className="menu" aria-expanded={open} aria-controls="side-body" onClick={() => setOpen(!open)}>Menu</button>
      <div className={`body ${open ? "open" : ""}`} id="side-body">
        <nav aria-label="Main">{LINKS.map(item)}</nav>
        <div className="group">Demo</div>
        <nav aria-label="Demo">
          {TOOLS.map(item)}
          <a href="/store" target="_blank" rel="noreferrer"><IconStore />Storefront<span className="ext"><IconExternal size={14} /></span><span className="sr-only"> (opens in a new tab)</span></a>
        </nav>
        <div className="foot">
          <div className="rule">{paymentDemo
            ? "Fallback and recovery start require an operator. Recovery steps follow the playbook. Rollback is automatic."
            : "fallback & recovery start: operator · steps & rollback: automatic"}</div>
          <div className="who">
            <span>Signed in as <b>{user}</b></span>
            <button onClick={logout}><IconLogout size={16} />Log out</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
