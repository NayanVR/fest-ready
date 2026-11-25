// Run with --preload for a controller whose upstream requests stay inside this process.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { render, type Playbook } from "../../src/playbooks.ts";

const seedDir = join(import.meta.dir, "../../playbooks");
const seed: Playbook = parse(readFileSync(join(seedDir, readdirSync(seedDir)[0]!), "utf8"));
const names = seed.dimension.values.flatMap((value) => [
  render(seed.segments.fallback, { value }), render(seed.segments.recovery, { value }),
]);
const enabled = new Map<number, boolean>();
const split = new Map<number, string>();
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === "/api/orders" && req.method === "POST") {
      const body = await req.json();
      if (body.fixtureRedirect) return new Response(null, { status: 307, headers: { Location: "/fixture/redirect-target" } });
      if (body.fixtureUnhealthy || body.synthetic !== true)
        return new Response("private fixture response", { status: seed.probe.expect.fallback_active.status });
      return new Response(null, { status: seed.probe.expect.healthy.status });
    }
    if (pathname === "/fixture/redirect-target") return new Response(null, { status: seed.probe.expect.healthy.status });
    if (pathname === `/api/v1/label/${seed.dimension.label}/values` && searchParams.get("limit") === "100")
      return Response.json({ status: "success", data: [...seed.dimension.values].reverse().concat(seed.dimension.values) });
    if (pathname === "/api/v1/label/fixture_upstream_error/values")
      return new Response("private fixture response", { status: 500 });
    if (req.headers.get("Authorization") !== "Api-Key fixture-management")
      return Response.json({}, { status: 401 });
    if (pathname === "/api/v1/projects/1/features/") {
      const term = searchParams.get("search") ?? "";
      if (term === "fixture-upstream-error") return new Response("private fixture response", { status: 500 });
      const features = [{ id: 2, name: seed.flag.key + "_other" }, { id: 1, name: seed.flag.key }];
      return Response.json({ results: features.filter(({ name }) => name.includes(term)) });
    }
    if (pathname === "/api/v1/projects/1/segments/")
      return Response.json({ results: names.map((name, i) => ({ name, id: i + 1 })).filter(({ name }) => name === searchParams.get("q")) });
    const segment = /^\/api\/v1\/projects\/1\/segments\/(\d+)\/$/.exec(pathname);
    if (segment) {
      const id = Number(segment[1]);
      if (req.method === "PUT") {
        const body = await req.json();
        split.set(id, body.rules[0].conditions[0].value);
      }
      return Response.json({ id, name: names[id - 1], rules: [{ conditions: [{ operator: "PERCENTAGE_SPLIT", value: split.get(id) ?? "0" }] }] });
    }
    const versions = "/api/v1/environments/1/features/1/versions/";
    if (pathname === versions && req.method === "POST") {
      const { feature_states_to_update: [change] } = await req.json();
      enabled.set(change.feature_segment.segment, change.enabled);
      return Response.json({ uuid: "live" }, { status: 201 });
    }
    if (pathname === versions) return Response.json({ results: [{ uuid: "live", is_live: true }] });
    if (pathname === versions + "live/featurestates/") {
      return Response.json(names.flatMap((_, i) => i % 2 === 0
        ? [{ feature_segment: { segment: i + 1 }, enabled: enabled.get(i + 1) ?? seed.flag.normal.enabled }]
        : []));
    }
    return Response.json({}, { status: 404 });
  },
});

const upstream = fixture.url.origin;
if (process.env.B7_FIXTURE_NO_UPSTREAMS !== "1") {
  process.env.SHOP_URL = upstream;
  process.env.PROMETHEUS_URL = upstream;
  process.env.FLAGSMITH_MGMT_TOKEN = "fixture-management";
  process.env.FLAGSMITH_PROJECT_ID = "1";
  process.env.FLAGSMITH_ENV_ID = "1";
}

const networkFetch = globalThis.fetch;
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin === "https://api.flagsmith.com") return networkFetch(upstream + url.pathname + url.search, init);
  if (url.origin === upstream) return networkFetch(input, init);
  throw new Error("unexpected upstream destination in playbook API fixture");
}, networkFetch);
