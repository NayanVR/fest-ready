import { afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcp, type FindingsResult } from "../src/mcp.ts";
import type { Playbook } from "../src/playbooks.ts";

const SEED_DIR = join(import.meta.dir, "../playbooks");
const playbooks: Playbook[] = readdirSync(SEED_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => parse(readFileSync(join(SEED_DIR, f), "utf8")));
const pb = playbooks[0]!;

let received: any;
const submitFindings = (input: any): FindingsResult => {
  received = input;
  const p = playbooks.find((x) => x.id === input.playbook);
  if (!p) return { accepted: false, error: "UNKNOWN_PLAYBOOK", message: `${input.playbook} is not a playbook` };
  if (!p.dimension.values.includes(input.value))
    return { accepted: false, error: "VALUE_NOT_ALLOWED", message: `${input.value} is not in [${p.dimension.values.join(", ")}]` };
  return { accepted: true, incident: "INC-0001" };
};

const srv = Bun.serve({ port: 0, fetch: (req) => handleMcp(req, { listPlaybooks: () => playbooks, submitFindings }) });
const url = new URL(`http://localhost:${srv.port}/mcp`);
afterAll(() => srv.stop(true));

async function client() {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(url));
  return c;
}
const parsed = (r: any) => JSON.parse(r.content[0].text);

test("tools/list shows both tools", async () => {
  const c = await client();
  const { tools } = await c.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["list_playbooks", "submit_findings"]);
  await c.close();
});

test("list_playbooks returns the catalog", async () => {
  const c = await client();
  const r = await c.callTool({ name: "list_playbooks", arguments: {} });
  expect(parsed(r)).toEqual(
    playbooks.map((p) => ({ id: p.id, description: p.description, cause: p.match.cause, alerts: p.match.alerts, dimension: p.dimension.name, values: p.dimension.values })),
  );
  await c.close();
});

test("value not in dimension.values is rejected with isError", async () => {
  const c = await client();
  const value = "not-a-" + pb.dimension.name;
  const r = await c.callTool({ name: "submit_findings", arguments: { playbook: pb.id, value, cause: pb.match.cause, summary: "x" } });
  expect(r.isError).toBe(true);
  expect(parsed(r)).toMatchObject({ accepted: false, error: "VALUE_NOT_ALLOWED" });
  await c.close();
});

test("valid call is accepted and the summary arrives byte-for-byte", async () => {
  const c = await client();
  const summary = 'Line one — "quoted" \'single\'\nLine two: ₹1,200 lost; emoji 🚚 and Devanagari नमस्ते\n\ttab \\ backslash';
  const r = await c.callTool({
    name: "submit_findings",
    arguments: { playbook: pb.id, value: pb.dimension.values[0], cause: pb.match.cause, summary, evidence: ["a"] },
  });
  expect(r.isError).toBeFalsy();
  expect(parsed(r)).toEqual({ accepted: true, incident: "INC-0001" });
  expect(received.summary).toBe(summary);
  await c.close();
});

test("GET and DELETE return 405", async () => {
  for (const method of ["GET", "DELETE"]) expect((await fetch(url, { method })).status).toBe(405);
});
