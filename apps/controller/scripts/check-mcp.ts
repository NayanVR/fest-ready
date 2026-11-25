// Usage: bun scripts/check-mcp.ts [url] [--submit <value>] [--summary <text>]
// Default url http://localhost:4100/mcp. Without --submit it only sends an invalid value (no incident is touched).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const submit = opt("--submit");
const summary = opt("--summary") ?? "TEST SUBMISSION from scripts/check-mcp.ts. This is not a NuBi finding.";
const url = args[0] ?? "http://localhost:4100/mcp";

const c = new Client({ name: "check-mcp", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL(url)));
const show = (label: string, x: unknown) => console.log(`\n== ${label}\n${JSON.stringify(x, null, 2)}`);

show("tools/list", (await c.listTools()).tools.map((t) => ({ name: t.name, description: t.description })));

const cat = await c.callTool({ name: "list_playbooks", arguments: {} });
const catalog = JSON.parse((cat.content as any)[0].text);
show("list_playbooks", catalog);
const pb = catalog[0];
if (!pb) throw new Error("no playbooks");

const bad = await c.callTool({ name: "submit_findings", arguments: { playbook: pb.id, value: "pune", cause: pb.cause, summary } });
show(`submit_findings invalid value (isError=${bad.isError})`, JSON.parse((bad.content as any)[0].text));

if (submit) {
  const ok = await c.callTool({ name: "submit_findings", arguments: { playbook: pb.id, value: submit, cause: pb.cause, summary } });
  show(`submit_findings ${submit} (isError=${ok.isError ?? false})`, JSON.parse((ok.content as any)[0].text));
}
await c.close();
