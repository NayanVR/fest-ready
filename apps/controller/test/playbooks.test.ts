import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { openDb } from "../src/db.ts";
import { getPlaybook, parseDuration, render, savePlaybook, seedPlaybooks, validatePlaybook } from "../src/playbooks.ts";

const SEED_DIR = join(import.meta.dir, "../playbooks");
const seed = () => parse(readFileSync(join(SEED_DIR, readdirSync(SEED_DIR)[0]!), "utf8"));
const broken = (mutate: (p: any) => void) => {
  const p = seed();
  mutate(p);
  return validatePlaybook(p);
};

test("seed playbook is valid", () => {
  expect(validatePlaybook(seed())).toEqual([]);
});

test("platform limits cannot be loosened", () => {
  expect(broken((p) => (p.recovery.guardrail.min_samples = 5))).toEqual(["recovery.guardrail.min_samples must be an integer ≥ 10"]);
  expect(broken((p) => (p.recovery.guardrail.max_error_rate = 0.3))[0]).toStartWith("recovery.guardrail.max_error_rate");
  expect(broken((p) => (p.recovery.guardrail.max_error_rate = 0))[0]).toStartWith("recovery.guardrail.max_error_rate");
  expect(broken((p) => (p.recovery.guardrail.max_consecutive_errors = 0))[0]).toStartWith("recovery.guardrail.max_consecutive_errors");
  for (const steps of [[20, 50, 100], [5, 10, 50], [5, 50, 10, 100], [5, 5, 100], [], [0, 100], [5.5, 100]])
    expect(broken((p) => (p.recovery.steps = steps))[0]).toStartWith("recovery.steps");
});

test("schema rules", () => {
  expect(broken((p) => (p.id = "Bad_Id"))[0]).toStartWith("id ");
  expect(broken((p) => delete p.owner)[0]).toStartWith("owner ");
  expect(broken((p) => (p.match.cause = "maybe"))[0]).toStartWith("match.cause");
  expect(broken((p) => (p.dimension.values = [...p.dimension.values, p.dimension.values[0]]))[0]).toStartWith("dimension.values");
  expect(broken((p) => (p.flag.fallback = { ...p.flag.normal }))).toEqual(["flag.normal and flag.fallback must differ"]);
  expect(broken((p) => (p.segments.fallback = "static-name"))[0]).toStartWith("segments.fallback");
  expect(broken((p) => (p.recovery.guardrail.window = "60"))[0]).toStartWith("recovery.guardrail.window");
  expect(broken((p) => (p.recovery.method = "magic"))[0]).toStartWith("recovery.method");
  expect(broken((p) => delete p.events.outcome_field)[0]).toStartWith("events.outcome_field");
  expect(broken((p) => delete p.probe.expect.fallback_active)[0]).toStartWith("probe.expect.fallback_active");
  expect(validatePlaybook(null)).toEqual(["playbook must be an object"]);
});

test("probe identities: exactly one per value", () => {
  const p = seed();
  const [first] = p.dimension.values;
  expect(broken((q) => delete q.probe.identities[first])).toEqual([`probe.identities is missing ${first}`]);
  expect(broken((q) => (q.probe.identities.other = "x"))).toEqual(["probe.identities has other, which is not in dimension.values"]);
});

test("only {value}, {probe_identity} and ${ENV} placeholders; PromQL braces are fine", () => {
  expect(broken((p) => (p.probe.request.url = "${SHOP_URL}/x/{customer}"))).toEqual(["probe.request.url: unknown placeholder {customer}"]);
  expect(broken((p) => (p.health.errors = 'sum(rate(m{a="{value}",b!="1"}[1m]))'))).toEqual([]);
});

test("render replaces placeholders deeply, single pass, and fails on missing values", () => {
  const p = seed();
  const value = p.dimension.values[1];
  const probe_identity = p.probe.identities[value];
  const req = render(p.probe.request, { value, probe_identity }, { SHOP_URL: "http://shop" });
  expect(req.url).toBe("http://shop/api/orders");
  expect(Object.values(req.body)).toContain(probe_identity);
  expect(req.body.synthetic).toBe(true); // non-strings untouched
  expect(render(p.segments.recovery, { value })).toBe(p.segments.recovery.replace("{value}", value));
  expect(render(p.health.total, { value })).toContain(`"${value}"`);
  expect(render("{value}", { value: "{probe_identity}" })).toBe("{probe_identity}");
  expect(() => render("${NOPE_NOT_SET}", {}, {})).toThrow("no value for placeholder ${NOPE_NOT_SET}");
  expect(() => render("{value}", {})).toThrow("no value for placeholder {value}");
});

test("parseDuration", () => {
  expect(parseDuration("60s")).toBe(60_000);
  expect(parseDuration("5m")).toBe(300_000);
  expect(() => parseDuration("5 minutes")).toThrow();
});

test("SQLite: seed once when empty, save bumps version, invalid save rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "controller-"));
  const db = openDb(join(dir, "data/c.db"));
  expect(seedPlaybooks(db, SEED_DIR)).toBe(1);
  expect(seedPlaybooks(db, SEED_DIR)).toBe(0);
  const id = seed().id;
  expect(getPlaybook(db, id)!.version).toBe(1);

  const res = savePlaybook(db, { ...seed(), owner: "someone-else", version: 99 });
  expect(res.ok && res.playbook.version).toBe(2);
  expect(getPlaybook(db, id)!.owner).toBe("someone-else");

  const bad = savePlaybook(db, { ...seed(), recovery: { ...seed().recovery, steps: [50, 100] } });
  expect(bad.ok).toBe(false);
  expect(getPlaybook(db, id)!.version).toBe(2);

  // An invalid seed file is a startup error, not a silent skip.
  writeFileSync(join(dir, "bad.yaml"), "id: Bad\n");
  expect(() => seedPlaybooks(openDb(join(dir, "other.db")), dir)).toThrow("seed bad.yaml is invalid");
});
