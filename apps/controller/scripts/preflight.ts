// Demo preflight: read-only checks that the stack is in the RUNBOOK §3 clean state and NudgeBee is reachable.
// Changes nothing. Exit 1 if any check fails.
// Usage (repo root .env is loaded by the package script): bun run preflight
import { $ } from "bun";
import { openDb } from "../src/db.ts";
import { readState, resolveTargets } from "../src/flagsmith.ts";
import { listPlaybooks, seedPlaybooks } from "../src/playbooks.ts";

const CTX = process.env.KUBE_CONTEXT || "kind-rehearsal";
const results: { ok: boolean; name: string; detail: string }[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    results.push({ ok: true, name, detail: await fn() });
  } catch (e) {
    results.push({ ok: false, name, detail: (e as Error).message });
  }
};
const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const get = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  return { status: r.status, body: await r.text() };
};
const kubectl = (args: string[]) => $`kubectl --context ${CTX} ${args}`.quiet().nothrow().text();

await check("controller, dashboard, shop-api /healthz", async () => {
  for (const p of [4100, 3000, 4001]) must((await get(`http://localhost:${p}/healthz`)).status === 200, `:${p} not healthy`);
  return ":4100 :3000 :4001 ok";
});

await check("deployments ready (shop-api, load-generator, controller, dashboard = 1)", async () => {
  const out = await kubectl(["-n", "shop", "get", "deploy", "-o", "jsonpath={range .items[*]}{.metadata.name}={.status.readyReplicas}/{.spec.replicas} {end}"]);
  for (const d of ["shop-api", "load-generator", "controller", "dashboard"]) must(out.includes(`${d}=1/1`), `${d} not 1/1 (${out.trim()})`);
  return out.trim();
});

await check("controller DB fresh (no incidents)", async () => {
  const list = JSON.parse((await get("http://localhost:4100/api/incidents")).body);
  must(list.length === 0, `${list.length} incident(s) present: reset with RUNBOOK §3 (delete the controller pod)`);
  return "0 incidents";
});

await check("orders flowing, availability high (no outage active)", async () => {
  const s = JSON.parse((await get("http://localhost:4100/api/state")).body);
  must(s.availability !== null, "no order events in the last 5 min: make load-start?");
  must(s.availability >= 0.99, `availability ${s.availability}: an outage may still be active (make outage-clear P=b)`);
  must(s.playbooks.broken === 0, `${s.playbooks.broken} playbook(s) broken`);
  return `availability ${s.availability}, playbooks ready ${s.playbooks.ready}`;
});

await check("Flagsmith normal for every playbook value (fallback off, split 0)", async () => {
  const db = openDb(":memory:");
  seedPlaybooks(db);
  const bad: string[] = [];
  for (const pb of listPlaybooks(db))
    for (const value of pb.dimension.values) {
      const s = await readState(pb, await resolveTargets(pb, value));
      if (s.fallbackActive || s.splitPercent !== 0) bad.push(`${value}: ${JSON.stringify(s)}`);
    }
  must(!bad.length, `not normal: ${bad.join("; ")} (run check-flagsmith --reset)`);
  return "all values normal";
});

await check("NudgeBee tunnel (:18080 UI, :18081 relay, :18082 collector)", async () => {
  must((await get("http://localhost:18080/")).status === 200, "UI :18080 not reachable: is tunnels.sh running?");
  for (const p of [18081, 18082]) {
    const ok = await new Promise<boolean>((res) => {
      Bun.connect({ hostname: "127.0.0.1", port: p, socket: { open: (s) => { s.end(); res(true); }, data() {}, error: () => res(false), connectError: () => res(false) } })
        .catch(() => res(false));
    });
    must(ok, `:${p} closed: is tunnels.sh running?`);
  }
  return "all three ports open";
});

await check("NudgeBee agents: no tunnel drops in the last 3 min", async () => {
  const runner = await kubectl(["-n", "nudgebee", "logs", "deploy/nudgebee-agent-runner", "--since=3m"]);
  const forager = await kubectl(["-n", "nudgebee", "logs", "deploy/nudgebee-forager-nudgebee-forager-chart", "--since=3m"]);
  const drops = (runner + forager).split("\n").filter((l) => l.includes("connection refused")).length;
  must(drops === 0, `${drops} "connection refused" lines: the tunnel is flapping; alerts can be lost (check the tunnels.sh terminal)`);
  return "no drops";
});

await check("NudgeBee VM running", async () => {
  const g = process.env.GCLOUD || "gcloud";
  const vm = process.env.NUDGEBEE_VM || "";
  const args = ["compute", "instances", "list", `--filter=name=${vm}`, "--format=value(status)"];
  const out = await $`${g} ${args}`.quiet().nothrow().text();
  must(out.trim() === "RUNNING", `VM ${vm} is ${out.trim() || "unknown"}`);
  return `${vm} RUNNING`;
});

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nREADY FOR THE DEMO");
process.exit(failed ? 1 : 0);
