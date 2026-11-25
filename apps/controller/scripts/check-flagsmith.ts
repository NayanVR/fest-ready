// B2 check: apply the fallback for one value, set split 5, read back, reset (split 0, fallback normal).
// Each step is verified from the shop side with flagsmith-nodejs local evaluation (FLAGSMITH_SERVER_KEY) over
// 200 identities per value, using the playbook's dimension trait. Always leaves Flagsmith reset.
// Usage: bun run check:flagsmith <playbook-id> <value> [--show | --reset]
import { Flagsmith } from "flagsmith-nodejs";
import { openDb } from "../src/db.ts";
import { getPlaybook, seedPlaybooks } from "../src/playbooks.ts";
import { apply, readState, resolveTargets } from "../src/flagsmith.ts";

const [playbookId, value, mode] = process.argv.slice(2);
if (!playbookId || !value) throw new Error("usage: check-flagsmith.ts <playbook-id> <value> [--show|--reset]");
const db = openDb(`${import.meta.dir}/../data/check.db`);
seedPlaybooks(db);
const pb = getPlaybook(db, playbookId);
if (!pb) throw new Error(`playbook ${playbookId} not found`);
if (!pb.dimension.values.includes(value)) throw new Error(`${value} is not in [${pb.dimension.values.join(", ")}]`);
if (!process.env.FLAGSMITH_SERVER_KEY) throw new Error("FLAGSMITH_SERVER_KEY is not set");

const N = 200;
// Identities follow the probe identity's shape with the trailing number replaced (0002..0201: skips the probe one).
const ids = (v: string) =>
  Array.from({ length: N }, (_, i) => pb.probe.identities[v]!.replace(/\d+$/, (d) => String(i + 2).padStart(d.length, "0")));

const sdk = new Flagsmith({ environmentKey: process.env.FLAGSMITH_SERVER_KEY, enableLocalEvaluation: true, environmentRefreshIntervalSeconds: 3600 });
const t = await resolveTargets(pb, value);
console.log(`targets: ${JSON.stringify(t)}`);

async function counts(): Promise<Record<string, number>> {
  await sdk.updateEnvironment();
  const out: Record<string, number> = {};
  for (const v of pb!.dimension.values) {
    let on = 0;
    for (const id of ids(v)) if ((await sdk.getIdentityFlags(id, { [pb!.dimension.trait]: v })).isFeatureEnabled(pb!.flag.key)) on++;
    out[v] = on;
  }
  return out;
}
const others = (c: Record<string, number>) => pb.dimension.values.every((v) => v === value || c[v] === N);
const fmt = (c: Record<string, number>) => pb.dimension.values.map((v) => `${v} ${c[v]}/${N}`).join(", ");

async function step(label: string, rb: { fallbackActive: boolean; splitPercent: number }, wantFallback: boolean, wantSplit: number,
  shopOk: (c: Record<string, number>) => boolean) {
  const adminOk = rb.fallbackActive === wantFallback && rb.splitPercent === wantSplit;
  console.log(`[${label}] admin read-back: ${JSON.stringify(rb)} → ${adminOk ? "OK" : "MISMATCH"}`);
  if (!adminOk) throw new Error(`${label}: admin read-back mismatch`);
  const start = Date.now();
  for (;;) {
    const c = await counts();
    const s = ((Date.now() - start) / 1000).toFixed(1);
    if (shopOk(c) && others(c)) return console.log(`[${label}] shop-side (local eval) after ${s}s: ${fmt(c)} → OK`);
    if (Date.now() - start > 60_000) throw new Error(`${label}: shop side never matched; last ${fmt(c)}`);
    console.log(`[${label}]   waiting (${s}s): ${fmt(c)}`);
    await Bun.sleep(3000);
  }
}

if (mode === "--show") {
  console.log(`admin read-back: ${JSON.stringify(await readState(pb, t))}`);
  console.log(`shop-side (local eval): ${fmt(await counts())}`);
  await sdk.close();
  process.exit(0);
}

let failed = false;
try {
  if (mode !== "--reset") {
    await step("baseline", await readState(pb, t), false, 0, (c) => c[value] === N);
    let r = await apply(pb, value, { fallback: true }, `B2 check: fallback on for ${value}`);
    await step("fallback on", r.readBack, true, 0, (c) => c[value] === 0);
    r = await apply(pb, value, { split: 5 }, `B2 check: split 5 for ${value}`);
    await step("split 5", r.readBack, true, 5, (c) => c[value]! > 0 && c[value]! < N / 4);
  }
} catch (e) {
  failed = true;
  console.error(`FAILED: ${(e as Error).message}`);
} finally {
  const r = await apply(pb, value, { fallback: false, split: 0 }, `B2 check: reset ${value}`);
  await step("reset", r.readBack, false, 0, (c) => c[value] === N);
  await sdk.close();
}
console.log(failed ? "CHECK FAILED (Flagsmith reset)" : "CHECK PASSED (Flagsmith reset)");
process.exit(failed ? 1 : 0);
