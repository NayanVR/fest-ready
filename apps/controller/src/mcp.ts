// MCP server (CONTRACTS.md §3.5): Streamable HTTP, stateless, JSON responses.
// Validation of findings lives in the caller (deps.submitFindings); this module only speaks MCP.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./log.ts";
import type { Playbook } from "./playbooks.ts";

export type FindingsResult = { accepted: true; incident: string } | { accepted: false; error: string; message: string };
export type McpDeps = { listPlaybooks(): Playbook[]; submitFindings(input: unknown): FindingsResult | Promise<FindingsResult> };

const TOOLS = [
  {
    name: "list_playbooks",
    description: "List the remediation playbooks: what failure each one is for, its cause, the alerts it applies to and its allowed values.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "submit_findings",
    description:
      "Call this once your investigation is done. Choose the playbook from `list_playbooks` whose description matches the failure, and a value from its allowed values. Use `playbook: null` if no playbook fits or the cause is our own change. `summary` is your findings in 3–5 sentences.",
    inputSchema: {
      type: "object" as const,
      properties: {
        playbook: { type: ["string", "null"] },
        value: { type: ["string", "null"] },
        cause: { type: "string", enum: ["external", "internal"] },
        summary: { type: "string", maxLength: 2000 },
        evidence: { type: "array", items: { type: "string" } },
        nubiUrl: { type: "string" },
      },
      required: ["playbook", "value", "cause", "summary"],
    },
  },
];

const text = (x: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(x) }], ...(isError && { isError }) });

function makeServer(deps: McpDeps) {
  const server = new Server({ name: "controller", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === "list_playbooks") {
      log("info", "mcp tool call", { tool: "list_playbooks" });
      return text(
        deps.listPlaybooks().map((p) => ({
          id: p.id,
          description: p.description,
          cause: p.match.cause,
          alerts: p.match.alerts,
          dimension: p.dimension.name,
          values: p.dimension.values,
        })),
      );
    }
    if (params.name === "submit_findings") {
      const r = await deps.submitFindings(params.arguments ?? {});
      // Never log the summary.
      log(r.accepted ? "info" : "warn", "mcp tool call", r.accepted ? { tool: "submit_findings", result: "accepted", incident: r.incident } : { tool: "submit_findings", result: "rejected", error: r.error });
      return text(r, !r.accepted);
    }
    log("warn", "mcp tool call", { tool: params.name, result: "rejected", error: "UNKNOWN_TOOL" });
    return text({ error: "UNKNOWN_TOOL", message: `unknown tool ${params.name}` }, true);
  });
  return server;
}

export async function handleMcp(req: Request, deps: McpDeps): Promise<Response> {
  if (req.method !== "POST")
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { Allow: "POST" } });
  const server = makeServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}
