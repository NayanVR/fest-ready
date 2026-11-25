import type { Database } from "bun:sqlite";
import { searchFeatureNames } from "./flagsmith.ts";
import { err, invalidPlaybook, type Result } from "./incidents.ts";
import { sendProbe } from "./loops.ts";
import { validateWritablePlaybook, type Playbook } from "./playbooks.ts";
import { draftReadiness, recentEventFields } from "./status.ts";

const ok = (body: unknown): Result => ({ status: 200, body });
const badRequest = (message: string) => err(400, "BAD_REQUEST", message);
const unconfigured = (service: string) => err(503, "DEPENDENCY_UNCONFIGURED", `${service} is not configured`);
const unreachable = (service: string) => err(502, "UPSTREAM_ERROR", `${service} request failed`);
const flagsmithConfigured = () => process.env.FLAGSMITH_MGMT_TOKEN && process.env.FLAGSMITH_PROJECT_ID;

export async function wizardFlags(input: any): Promise<Result> {
  const term = typeof input?.search === "string" ? input.search.trim() : "";
  if (!term || term.length > 128) return badRequest("search must be a nonempty string of at most 128 characters");
  if (!flagsmithConfigured()) return unconfigured("Flagsmith");
  try {
    return ok({ flags: await searchFeatureNames(term) });
  } catch {
    return unreachable("Flagsmith");
  }
}

export async function wizardLabelValues(input: any): Promise<Result> {
  const label = input?.label;
  if (typeof label !== "string" || label.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label))
    return badRequest("label must be a Prometheus label name of at most 128 characters");
  const base = process.env.PROMETHEUS_URL;
  if (!base) return unconfigured("Prometheus");
  const limit = 100;
  try {
    const url = new URL(`/api/v1/label/${label}/values`, base);
    const now = Math.floor(Date.now() / 1000);
    url.searchParams.set("start", String(now - 10 * 60));
    url.searchParams.set("end", String(now));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!res.ok) {
      await res.body?.cancel();
      return unreachable("Prometheus");
    }
    const result = await res.json();
    if (result?.status !== "success" || !Array.isArray(result.data)) return unreachable("Prometheus");
    const values = result.data.slice(0, limit).filter((value: unknown): value is string => typeof value === "string");
    return ok({ values: [...new Set<string>(values)].sort() });
  } catch {
    return unreachable("Prometheus");
  }
}

export function wizardEventFields(db: Database, input: unknown): Result {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)
    return badRequest("expected an empty JSON object");
  return ok({ fields: recentEventFields(db) });
}

export async function wizardReadiness(db: Database, input: unknown): Promise<Result> {
  const reasons = validateWritablePlaybook(input);
  if (reasons.length) return invalidPlaybook(reasons);
  if (!flagsmithConfigured()) return unconfigured("Flagsmith");
  try {
    return ok(await draftReadiness(db, input as Playbook));
  } catch {
    return unreachable("Flagsmith");
  }
}

export async function wizardProbe(input: any): Promise<Result> {
  const reasons = validateWritablePlaybook(input?.playbook);
  if (reasons.length) return invalidPlaybook(reasons);
  const pb = input.playbook as Playbook;
  const value = input.value;
  if (typeof value !== "string" || !pb.dimension.values.includes(value))
    return badRequest("value must be an allowed playbook dimension value");
  if (!process.env.SHOP_URL) return unconfigured("Shop API");
  const probe = await sendProbe(pb, value, true);
  if (probe.status === null) return unreachable("Shop API");
  return ok({ healthy: probe.ok, status: probe.status, error: probe.error });
}
