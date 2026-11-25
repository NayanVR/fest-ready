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

async function startController(dbPath: string, noUpstreams = false) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", "./test/fixtures/playbook-api.ts", "src/index.ts"], {
    cwd: root,
    env: { PORT: "0", DB_PATH: dbPath, PLAYBOOK_DIR: seedDir, ADMIN_SECRET: secret, B7_FIXTURE_NO_UPSTREAMS: noUpstreams ? "1" : "0" },
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

test("wizard discovers live fixture inputs and checks drafts without changing saved readiness", async () => {
  const dir = mkdtempSync(join(tmpdir(), "controller-playbook-wizard-"));
  const path = join(dir, "controller.db");
  let controller: Awaited<ReturnType<typeof startController>> | undefined;
  try {
    controller = await startController(path);
    const { call } = controller;
    const wizard = "/api/playbook-wizard/";
    for (const route of ["flags", "label-values", "event-fields", "readiness", "probe"])
      expect(await call(wizard + route, "POST", {}, null)).toMatchObject({ status: 401, body: { error: "UNAUTHORIZED" } });
    expect(await call(wizard + "flags", "POST", { search: " " })).toMatchObject({ status: 400 });
    expect(await call(wizard + "flags", "POST", { search: seed.flag.key.slice(0, -1) })).toEqual({
      status: 200, body: { flags: [seed.flag.key, seed.flag.key + "_other"] },
    });
    expect(await call(wizard + "flags", "POST", { search: "fixture-upstream-error" })).toEqual({
      status: 502, body: { error: "UPSTREAM_ERROR", message: "Flagsmith request failed" },
    });
    expect(await call(wizard + "label-values", "POST", { label: "../unsafe" })).toMatchObject({ status: 400 });
    expect(await call(wizard + "label-values", "POST", { label: seed.dimension.label })).toEqual({
      status: 200, body: { values: [...seed.dimension.values].sort() },
    });
    expect(await call(wizard + "label-values", "POST", { label: "fixture_upstream_error" })).toEqual({
      status: 502, body: { error: "UPSTREAM_ERROR", message: "Prometheus request failed" },
    });
    expect(await call(wizard + "event-fields", "POST", { unexpected: true })).toMatchObject({ status: 400 });
    expect(await call(wizard + "event-fields", "POST", {})).toEqual({ status: 200, body: { fields: [] } });

    for (const value of seed.dimension.values) {
      expect((await call("/internal/orders", "POST", { [seed.events.dimension_field]: value, fixtureKey: { nested: "private" } })).status).toBe(202);
    }
    expect(await call(wizard + "event-fields", "POST", {})).toEqual({
      status: 200, body: { fields: [seed.events.dimension_field, "fixtureKey"].sort() },
    });
    const saved = "/api/playbooks/" + seed.id;
    expect((await call(saved)).body.readiness).toBe("ready");
    expect(await call(wizard + "readiness", "POST", seed)).toEqual({ status: 200, body: { readiness: "ready", reasons: [] } });
    const draft = { ...seed, flag: { ...seed.flag, key: "missing-fixture-flag" } };
    expect(await call(wizard + "readiness", "POST", draft)).toEqual({
      status: 200, body: { readiness: "broken", reasons: ["flag missing-fixture-flag not found in Flagsmith"] },
    });
    expect((await call(saved)).body).toMatchObject({ flag: seed.flag, readiness: "ready", version: 1 });
    expect(await call(wizard + "readiness", "POST", { ...seed, flag: { ...seed.flag, key: "fixture-upstream-error" } })).toEqual({
      status: 502, body: { error: "UPSTREAM_ERROR", message: "Flagsmith request failed" },
    });

    const unsupported = { ...seed, recovery: { ...seed.recovery, method: "segments" } };
    const value = seed.dimension.values[0]!;
    for (const [route, method, payload] of [
      ["/api/playbooks", "POST", unsupported], [saved, "PUT", unsupported],
      [wizard + "readiness", "POST", unsupported], [wizard + "probe", "POST", { playbook: unsupported, value }],
    ] as const) {
      expect(await call(route, method, payload)).toMatchObject({
        status: 422, body: { error: "INVALID_PLAYBOOK", reasons: ["recovery.method must be split"] },
      });
    }

    expect(await call(wizard + "probe", "POST", { playbook: seed, value: "outside-cohort" })).toMatchObject({ status: 400 });
    const probeDraft = structuredClone(seed);
    probeDraft.probe.request.body = { ...(seed.probe.request.body as object), synthetic: false };
    expect(await call(wizard + "probe", "POST", { playbook: probeDraft, value })).toEqual({
      status: 200, body: { healthy: true, status: seed.probe.expect.healthy.status, error: null },
    });
    Object.assign(probeDraft.probe.request.body as object, { fixtureUnhealthy: true });
    expect(await call(wizard + "probe", "POST", { playbook: probeDraft, value })).toEqual({
      status: 200, body: { healthy: false, status: seed.probe.expect.fallback_active.status, error: "fallback_active" },
    });
    Object.assign(probeDraft.probe.request.body as object, { fixtureRedirect: true });
    expect(await call(wizard + "probe", "POST", { playbook: probeDraft, value })).toEqual({
      status: 502, body: { error: "UPSTREAM_ERROR", message: "Shop API request failed" },
    });
    expect((await call("/api/audit")).body).toEqual([]);
    expect((await call("/api/incidents")).body).toEqual([]);
    expect((await call("/api/playbooks")).body).toHaveLength(1);

    await controller.stop();
    controller = undefined;
    controller = await startController(path, true);
    for (const [route, payload] of [
      ["flags", { search: seed.flag.key }], ["label-values", { label: seed.dimension.label }],
      ["readiness", seed], ["probe", { playbook: seed, value }],
    ] as const) {
      expect(await controller.call(wizard + route, "POST", payload)).toMatchObject({
        status: 503, body: { error: "DEPENDENCY_UNCONFIGURED" },
      });
    }
  } finally {
    await controller?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
