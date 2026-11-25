// Flagsmith Admin API client. Uses ONLY the calls recorded in CONTRACTS.md §5.
// The environment uses v2 feature versioning: override changes publish a new feature version.
// The fallback override always exists; this client never creates or deletes overrides.
// Every action is one write + one read-back of what was written (no read before the write).
import { log } from "./log.ts";
import { render, type FlagState, type Playbook } from "./playbooks.ts";

const BASE = "https://api.flagsmith.com/api/v1";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function api(method: string, path: string, body?: unknown, signal = AbortSignal.timeout(15_000)): Promise<any> {
  const base = process.env.FLAGSMITH_ADMIN_URL?.trim().replace(/\/+$/, "") || BASE;
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Api-Key ${env("FLAGSMITH_MGMT_TOKEN")}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Flagsmith ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const project = () => `/projects/${env("FLAGSMITH_PROJECT_ID")}`;
const environment = () => `/environments/${env("FLAGSMITH_ENV_ID")}`;

async function searchFeatures(term: string): Promise<{ name: string; id: number }[]> {
  const r = await api("GET", `${project()}/features/?search=${encodeURIComponent(term)}`);
  return r.results;
}

export async function searchFeatureNames(term: string): Promise<string[]> {
  const features = await searchFeatures(term);
  return [...new Set(features.slice(0, 100).map(({ name }) => name).filter((name) => typeof name === "string"))].sort();
}

async function catalogNames(resource: "features" | "segments", filter: "search" | "q"): Promise<string[]> {
  const limit = 1000;
  const names = new Set<string>();
  const signal = AbortSignal.timeout(5000);
  const path = `${project()}/${resource}/`;
  const params = new URLSearchParams([[filter, ""]]);
  for (let page = 1; page <= 10 && names.size < limit; page++) {
    const result = await api("GET", `${path}?${params}`, undefined, signal);
    if (!Array.isArray(result?.results)) throw new Error("Invalid Flagsmith catalog response");
    for (const entry of result.results) {
      if (typeof entry?.name === "string" && entry.name.trim()) names.add(entry.name);
    }
    if (typeof result.next !== "string" || !result.next) break;
    // Reconstruct the next request against the configured project endpoint.
    const next = new URL(result.next, BASE).searchParams.get("page");
    if (next !== String(page + 1)) break;
    params.set("page", next);
  }
  return Array.from(names).sort().slice(0, limit);
}

export const listFeatureNames = () => catalogNames("features", "search");
export const listSegmentNames = () => catalogNames("segments", "q");

// Search is a substring match, so filter for the exact name.
export async function findFeatureId(name: string): Promise<number | null> {
  return (await searchFeatures(name)).find((f) => f.name === name)?.id ?? null;
}

export async function findSegmentId(name: string): Promise<number | null> {
  const r = await api("GET", `${project()}/segments/?q=${encodeURIComponent(name)}`);
  return r.results.find((s: any) => s.name === name)?.id ?? null;
}

export type Override = { segment: number | null; enabled: boolean };

// Live feature states. When the live version uuid is known (returned by the publish POST), the versions list is skipped.
export async function readOverrides(featureId: number, liveUuid?: string): Promise<Override[]> {
  let uuid = liveUuid;
  if (!uuid) {
    const versions = await api("GET", `${environment()}/features/${featureId}/versions/`);
    uuid = versions.results.find((v: any) => v.is_live === true)?.uuid;
    if (!uuid) throw new Error(`feature ${featureId} has no live version`);
  }
  const states = await api("GET", `${environment()}/features/${featureId}/versions/${uuid}/featurestates/`);
  return states.map((s: any) => ({ segment: s.feature_segment?.segment ?? null, enabled: s.enabled }));
}

// Publishes a new live version with the segment override set to `state`. Returns the new version's uuid.
async function setSegmentOverride(featureId: number, segmentId: number, state: FlagState, description: string): Promise<string | undefined> {
  const v = await api("POST", `${environment()}/features/${featureId}/versions/`, {
    publish_immediately: true,
    description,
    feature_states_to_update: [{
      feature_segment: { segment: segmentId },
      enabled: state.enabled,
      // ponytail: value-type playbooks send the value as unicode (the only recorded form, not exercised live)
      feature_state_value: { type: "unicode", string_value: state.value === undefined ? null : String(state.value) },
    }],
  });
  return typeof v?.uuid === "string" ? v.uuid : undefined;
}

function splitCondition(segment: any): any {
  const found: any[] = [];
  const walk = (rules: any[]) => {
    for (const r of rules ?? []) {
      for (const c of r.conditions ?? []) if (c.operator === "PERCENTAGE_SPLIT") found.push(c);
      walk(r.rules);
    }
  };
  walk(segment.rules);
  if (found.length !== 1) throw new Error(`segment ${segment.id} has ${found.length} PERCENTAGE_SPLIT conditions, expected 1`);
  return found[0];
}

// Last segment body read per id. Only the controller edits these segments at runtime (only the split value),
// so the cached body is PUT back with the new value: no GET before the write once the segment has been read.
const segments = new Map<number, any>();

export async function getSplit(segmentId: number): Promise<number> {
  const seg = await api("GET", `${project()}/segments/${segmentId}/`);
  segments.set(segmentId, seg);
  return Number(splitCondition(seg).value);
}

// Change only the split value and PUT {name, rules} back (rule and condition ids kept).
async function setSplit(segmentId: number, n: number) {
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`split must be an integer 0–100, got ${n}`);
  const path = `${project()}/segments/${segmentId}/`;
  if (!segments.has(segmentId)) await getSplit(segmentId); // first use only; normally done by warm()
  const seg = structuredClone(segments.get(segmentId));
  splitCondition(seg).value = String(n);
  segments.delete(segmentId); // unknown until read back
  await api("PUT", path, { name: seg.name, rules: seg.rules });
}

// ---- playbook-level API ----

export type Targets = { featureId: number; fallbackSegmentId: number; recoverySegmentId: number };
// The audit flag-state shape (CONTRACTS.md §3.4 "Other read shapes").
export type FlagStateView = { fallbackActive: boolean; fallbackEnabled: boolean; fallbackValue: string | null; splitPercent: number };

// IDs never change at runtime: looked up by name once per (flag, segments) and cached. A failed lookup is retried.
const targets = new Map<string, Promise<Targets>>();
// Last state read back per target; serves as the audit "before" (null if never read).
const known = new Map<string, FlagStateView>();
const keyOf = (t: Targets) => `${t.featureId}/${t.fallbackSegmentId}/${t.recoverySegmentId}`;

export function resolveTargets(pb: Playbook, value: string): Promise<Targets> {
  const fallbackName = render(pb.segments.fallback, { value });
  const recoveryName = render(pb.segments.recovery, { value });
  const key = `${pb.flag.key}|${fallbackName}|${recoveryName}`;
  let p = targets.get(key);
  if (!p) {
    p = (async () => {
      const [featureId, fallbackSegmentId, recoverySegmentId] = await Promise.all([
        findFeatureId(pb.flag.key), findSegmentId(fallbackName), findSegmentId(recoveryName),
      ]);
      if (featureId === null) throw new Error(`feature ${pb.flag.key} not found`);
      if (fallbackSegmentId === null) throw new Error(`segment ${fallbackName} not found`);
      if (recoverySegmentId === null) throw new Error(`segment ${recoveryName} not found`);
      return { featureId, fallbackSegmentId, recoverySegmentId };
    })();
    targets.set(key, p);
    p.catch(() => targets.delete(key));
  }
  return p;
}

function view(pb: Playbook, fallbackEnabled: boolean, split: number): FlagStateView {
  return {
    fallbackActive: fallbackEnabled === pb.flag.fallback.enabled,
    fallbackEnabled,
    fallbackValue: pb.flag.fallback.value === undefined ? null : String(pb.flag.fallback.value),
    splitPercent: split,
  };
}

function fallbackOf(overrides: Override[], t: Targets): Override {
  const fb = overrides.find((o) => o.segment === t.fallbackSegmentId);
  if (!fb) throw new Error(`fallback override for segment ${t.fallbackSegmentId} is missing`);
  return fb;
}

// Full read of the current state (startup warm-up, readiness, checks).
export async function readState(pb: Playbook, t: Targets): Promise<FlagStateView> {
  const [overrides, split] = await Promise.all([readOverrides(t.featureId), getSplit(t.recoverySegmentId)]);
  const state = view(pb, fallbackOf(overrides, t).enabled, split);
  known.set(keyOf(t), state);
  return state;
}

// Look up IDs and read the state ahead of time so the first action pays only for its write + read-back.
export async function warm(pb: Playbook, value: string) {
  const t = await resolveTargets(pb, value);
  if (!known.has(keyOf(t))) await readState(pb, t);
}

// Writes the requested fallback state and/or split, then reads back only what was written.
// fallback: true = playbook flag.fallback, false = flag.normal. Turning the fallback off with a split change goes
// fallback first, so canary customers never lose delivery while the split drops.
export async function apply(pb: Playbook, value: string, change: { fallback?: boolean; split?: number }, description: string) {
  const t = await resolveTargets(pb, value);
  const key = keyOf(t);
  const before = known.get(key) ?? null;
  // A split already known to have the requested value (approve's "split stays 0") is not rewritten.
  if (change.split !== undefined && change.split === before?.splitPercent) change = { ...change, split: undefined };
  const writeFallback = async () => {
    const uuid = await setSegmentOverride(t.featureId, t.fallbackSegmentId, change.fallback ? pb.flag.fallback : pb.flag.normal, description);
    return fallbackOf(await readOverrides(t.featureId, uuid), t).enabled;
  };
  const writeSplit = async () => {
    await setSplit(t.recoverySegmentId, change.split!);
    return getSplit(t.recoverySegmentId);
  };
  try {
    let fallbackEnabled: boolean | undefined, split: number | undefined;
    if (change.fallback === false && change.split !== undefined) {
      fallbackEnabled = await writeFallback();
      split = await writeSplit();
    } else {
      [fallbackEnabled, split] = await Promise.all([
        change.fallback === undefined ? undefined : writeFallback(),
        change.split === undefined ? undefined : writeSplit(),
      ]);
    }
    // Parts not written keep their last known value; unknown parts are read once so read-back is complete.
    if (fallbackEnabled === undefined) fallbackEnabled = before?.fallbackEnabled ?? fallbackOf(await readOverrides(t.featureId), t).enabled;
    if (split === undefined) split = before?.splitPercent ?? (await getSplit(t.recoverySegmentId));
    const readBack = view(pb, fallbackEnabled, split);
    known.set(key, readBack);
    log("info", "flagsmith write", { value, change, before, readBack });
    return { before, readBack };
  } catch (e) {
    known.delete(key);
    log("error", "flagsmith write failed", { value, change, error: (e as Error).message });
    throw e;
  }
}
