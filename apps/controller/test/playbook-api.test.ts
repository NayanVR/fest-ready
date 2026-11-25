import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { openDb } from "../src/db.ts";
import { getPlaybook, seedPlaybooks, type Playbook } from "../src/playbooks.ts";

const root = join(import.meta.dir, "..");
const seedDir = join(root, "playbooks");
const seed: Playbook = parse(readFileSync(join(seedDir, readdirSync(seedDir)[0]!), "utf8"));
const secret = "fixture-admin";

async function startController(dbPath: string) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", "./test/fixtures/playbook-api.ts", "src/index.ts"], {
    cwd: root,
    env: { PORT: "0", DB_PATH: dbPath, PLAYBOOK_DIR: seedDir, ADMIN_SECRET: secret },
    stdout: "pipe",
    stderr: "inherit",
  });
  const stop = async () => {
    child.kill();
    await child.exited;
  };
  let buffer = "";
  let base: string | undefined;
  const decoder = new TextDecoder();
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      const startup = lines.map((line) => JSON.parse(line)).find((entry) => entry.msg === "controller listening");
      if (startup) {
        base = `http://127.0.0.1:${startup.port}`;
        break;
      }
    }
    if (!base) throw new Error("fixture controller did not start");
  } catch (e) {
    await stop();
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  const call = async (path: string, method = "GET", body?: unknown, key: string | null = secret) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (key !== null) headers.set("X-Admin-Secret", key);
    const res = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, stop };
}

test("playbook writes use real HTTP, audit atomically, and preserve an incident's playbook", async () => {
  const dir = mkdtempSync(join(tmpdir(), "controller-playbook-api-"));
  const path = join(dir, "controller.db");
  let controller: Awaited<ReturnType<typeof startController>> | undefined;
  try {
    controller = await startController(path);
    const { call } = controller;
    const collection = "/api/playbooks";
    const draft = { ...seed, id: "api-fixture", version: 999 };
    const item = collection + "/" + draft.id;
    for (const [route, method, key] of [[collection, "POST", null], [item, "PUT", "bad"]] as const) {
      expect(await call(route, method, draft, key)).toMatchObject({ status: 401, body: { error: "UNAUTHORIZED" } });
    }
    expect(await call(collection, "POST", "{")).toMatchObject({
      status: 422, body: { error: "INVALID_PLAYBOOK", reasons: ["playbook must be an object"] },
    });
    const bad = structuredClone(draft);
    bad.recovery.guardrail.min_samples = 1;
    expect(await call(collection, "POST", bad)).toMatchObject({
      status: 422, body: { error: "INVALID_PLAYBOOK", reasons: ["recovery.guardrail.min_samples must be an integer ≥ 10"] },
    });
    const unsafe = structuredClone(draft);
    unsafe.probe.request.url = "http://127.0.0.1/elsewhere";
    unsafe.probe.request.body = { token: "${FLAGSMITH_MGMT_TOKEN}" };
    expect(await call(collection, "POST", unsafe)).toMatchObject({
      status: 422, body: { error: "INVALID_PLAYBOOK", reasons: [
        "probe.request must POST to ${SHOP_URL}/api/orders", "probe.request.body must not contain environment placeholders",
      ] },
    });
    expect(await call(item, "PUT", draft)).toMatchObject({ status: 404, body: { error: "NOT_FOUND" } });
    expect(await call(collection, "POST", { ...draft, actor: "Alice" })).toEqual({
      status: 201, body: { ...draft, version: 1 },
    });
    expect(await call(collection, "POST", draft)).toMatchObject({ status: 409, body: { error: "PLAYBOOK_EXISTS" } });
    expect(await call(item, "PUT", { ...draft, id: "another-id" })).toMatchObject({
      status: 422, body: { error: "INVALID_PLAYBOOK", reasons: ["id must match the URL"] },
    });

    const alert = draft.match.alerts[0]!;
    const opened = await call("/webhooks/alertmanager", "POST", { alerts: [{ status: "firing", labels: { alertname: alert } }] });
    const [id] = opened.body.incidents;
    const incident = "/api/incidents/" + id;
    expect((await call(incident + "/findings", "POST", {
      source: "operator", playbook: draft.id, value: draft.dimension.values[0], cause: draft.match.cause, summary: "Fixture operator findings.",
    })).status).toBe(200);

    const edited = structuredClone(draft);
    edited.recovery.guardrail.min_samples += 1;
    edited.flag.key = "different-fixture-target";
    edited.owner = "edited-owner";
    expect(await call(item, "PUT", edited)).toEqual({ status: 200, body: { ...edited, version: 2 } });
    expect(await call(incident + "/approve", "POST", {})).toMatchObject({
      status: 200, body: { recovery: { state: "FALLBACK" } },
    });
    expect(await call(incident)).toMatchObject({
      status: 200, body: { recovery: { state: "FALLBACK", minSamples: draft.recovery.guardrail.min_samples } },
    });

    const db = openDb(path);
    try {
      db.run(`CREATE TRIGGER refuse_playbook_audit BEFORE INSERT ON audit
        WHEN NEW.action LIKE 'playbook %' BEGIN SELECT RAISE(ABORT, 'fixture audit rejection'); END`);
      expect(await call(item, "PUT", edited)).toMatchObject({ status: 500, body: { error: "INTERNAL" } });
      expect(getPlaybook(db, draft.id)).toEqual({ ...edited, version: 2 });
      db.run("DROP TRIGGER refuse_playbook_audit");
    } finally {
      db.close();
    }

    await controller.stop();
    controller = undefined;
    controller = await startController(path);
    expect(await controller.call(item)).toMatchObject({
      status: 200, body: { ...edited, version: 2, readiness: "broken", reasons: expect.any(Array) },
    });
    expect((await controller.call(collection)).body).toHaveLength(2);
    expect((await controller.call("/api/audit")).body.filter((r: any) => r.incidentId === null)).toEqual([
      { ts: expect.any(String), incidentId: null, actor: "operator", action: "playbook updated: api-fixture v2",
        before: null, after: null, readBack: null, result: "ok" },
      { ts: expect.any(String), incidentId: null, actor: "Alice", action: "playbook created: api-fixture v1",
        before: null, after: null, readBack: null, result: "ok" },
    ]);
    const audit = (await controller.call(`/api/audit?incident=${id}`)).body;
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ incidentId: id, readBack: { fallbackActive: true, splitPercent: 0 } });
  } finally {
    await controller?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("opening a pre-B7 database preserves the playbook used by existing incidents", () => {
  const dir = mkdtempSync(join(tmpdir(), "controller-playbook-migration-"));
  const path = join(dir, "controller.db");
  try {
    const old = openDb(path);
    seedPlaybooks(old, seedDir);
    old.run("ALTER TABLE incidents DROP COLUMN playbook_snapshot");
    old.run("INSERT INTO incidents (alert, state, playbook, opened_at) VALUES (?, 'FALLBACK', ?, ?)",
      [seed.match.alerts[0]!, seed.id, new Date().toISOString()]);
    old.close();

    const migrated = openDb(path);
    try {
      const row = migrated.query<{ playbook_snapshot: string }, []>("SELECT playbook_snapshot FROM incidents").get()!;
      expect(JSON.parse(row.playbook_snapshot)).toEqual(getPlaybook(migrated, seed.id));
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
