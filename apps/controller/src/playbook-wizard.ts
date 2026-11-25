import type { Database } from "bun:sqlite";
import { listFeatureNames, listSegmentNames, searchFeatureNames } from "./flagsmith.ts";
import { err, invalidPlaybook, type Result } from "./incidents.ts";
import { sendProbe } from "./loops.ts";
import { listPlaybooks, validateWritablePlaybook, type Playbook } from "./playbooks.ts";
import { sarvamVoiceConfigured } from "./sarvam-voice.ts";
import { draftReadiness, recentEventFields } from "./status.ts";

const ok = (body: unknown): Result => ({ status: 200, body });
const badRequest = (message: string) => err(400, "BAD_REQUEST", message);
const unconfigured = (service: string) => err(503, "DEPENDENCY_UNCONFIGURED", `${service} is not configured`);
const unreachable = (service: string) => err(502, "UPSTREAM_ERROR", `${service} request failed`);
const flagsmithConfigured = () => process.env.FLAGSMITH_MGMT_TOKEN && process.env.FLAGSMITH_PROJECT_ID;
const emptyObject = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) && !Object.keys(input).length;
const sortedStrings = (values: unknown[]) => [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();

async function prometheusData(base: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, base);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error("Prometheus request failed");
  }
  const result = await res.json();
  if (result?.status !== "success") throw new Error("Invalid Prometheus response");
  return result.data;
}

async function prometheusNames(base: string, path: string, limit: number, metric?: string) {
  const now = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = { start: String(now - 10 * 60), end: String(now), limit: String(limit) };
  if (metric) params["match[]"] = `{__name__="${metric}"}`;
  const data = await prometheusData(base, path, params);
  if (!Array.isArray(data)) throw new Error("Invalid Prometheus catalog response");
  return sortedStrings(data.slice(0, limit));
}

async function prometheusAlerts(base: string): Promise<string[]> {
  const data = await prometheusData(base, "/api/v1/rules", { type: "alert", exclude_alerts: "true" }) as {
    groups?: { rules?: { type?: string; name?: string }[] }[];
  };
  if (!Array.isArray(data?.groups)) throw new Error("Invalid Prometheus rules response");
  return sortedStrings(data.groups.flatMap((group) => Array.isArray(group?.rules)
    ? group.rules.filter((rule) => rule?.type === "alerting").map((rule) => rule.name)
    : [])).slice(0, 1000);
}

export async function wizardCatalog(db: Database, input: unknown): Promise<Result> {
  if (!emptyObject(input)) return badRequest("expected an empty JSON object");
  const unavailable: string[] = [];
  async function discover(name: string, load?: () => Promise<string[]>) {
    try {
      if (load) return await load();
    } catch {
      // Other discovery sources are still useful when this one is unavailable.
    }
    unavailable.push(name);
    return [];
  }
  const flagsmith = flagsmithConfigured();
  const prometheus = process.env.PROMETHEUS_URL;
  const [flags, segments, metrics, labels, configuredAlerts] = await Promise.all([
    discover("Flagsmith flags", flagsmith ? listFeatureNames : undefined),
    discover("Flagsmith segments", flagsmith ? listSegmentNames : undefined),
    discover("Prometheus metrics", prometheus ? () => prometheusNames(prometheus, "/api/v1/label/__name__/values", 2000) : undefined),
    discover("Prometheus labels", prometheus ? () => prometheusNames(prometheus, "/api/v1/labels", 500) : undefined),
    discover("Prometheus alerts", prometheus ? () => prometheusAlerts(prometheus) : undefined),
  ]);
  const observedAlerts = db.query<{ alert: string }, []>(
    "SELECT alert FROM incidents GROUP BY alert ORDER BY MAX(n) DESC LIMIT 1000",
  ).all().map(({ alert }) => alert);
  const savedAlerts = listPlaybooks(db).flatMap((playbook) => playbook.match.alerts);
  return ok({
    flags, segments, metrics: metrics.filter(Boolean), labels: labels.filter((name) => name && !name.startsWith("__")),
    alerts: sortedStrings([...configuredAlerts, ...observedAlerts, ...savedAlerts]).filter(Boolean),
    eventFields: recentEventFields(db),
    approvalCallAvailable: sarvamVoiceConfigured(),
    unavailable: unavailable.sort(),
  });
}

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
  const { label, metric } = input ?? {};
  if (typeof label !== "string" || label.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label))
    return badRequest("label must be a Prometheus label name of at most 128 characters");
  if (metric !== undefined && (typeof metric !== "string" || metric.length > 256 || !/^[A-Za-z_:][A-Za-z0-9_:]*$/.test(metric)))
    return badRequest("metric must be a Prometheus metric name of at most 256 characters");
  const base = process.env.PROMETHEUS_URL;
  if (!base) return unconfigured("Prometheus");
  try {
    return ok({ values: await prometheusNames(base, `/api/v1/label/${label}/values`, 100, metric) });
  } catch {
    return unreachable("Prometheus");
  }
}

export function wizardEventFields(db: Database, input: unknown): Result {
  if (!emptyObject(input)) return badRequest("expected an empty JSON object");
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
