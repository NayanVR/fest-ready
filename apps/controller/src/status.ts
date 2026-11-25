// Playbook readiness (CONTRACTS §8) and overall availability for GET /api/state.
import type { Database } from "bun:sqlite";
import { findFeatureId, findSegmentId } from "./flagsmith.ts";
import { countOpenIncidents, eventsSince } from "./incidents.ts";
import { isProbe, listPlaybooks, render, type Playbook } from "./playbooks.ts";
import type { Ev } from "./recovery.ts";

const READINESS_EVENTS_MS = 10 * 60_000;
const AVAILABILITY_MS = 5 * 60_000;
// The dashboard polls every 2 s; Flagsmith lookups (1 + 2 per value) are cached to protect the API quota.
const FLAGSMITH_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; reasons: Promise<string[]> }>();

async function flagsmithReasons(pb: Playbook): Promise<string[]> {
  const names = pb.dimension.values.flatMap((value) => [render(pb.segments.fallback, { value }), render(pb.segments.recovery, { value })]);
  const [feature, ...segments] = await Promise.all([findFeatureId(pb.flag.key), ...names.map(findSegmentId)]);
  return [
    ...(feature === null ? [`flag ${pb.flag.key} not found in Flagsmith`] : []),
    ...names.filter((_, i) => segments[i] === null).map((n) => `segment ${n} not found in Flagsmith`),
  ];
}

// ponytail: event-based only; the PromQL `health` alternative is unverified ([VERIFY] in ARCHITECTURE §9.3)
export function eventReasons(pb: Playbook, events: Ev[]): string[] {
  const field = pb.events.dimension_field;
  const seen = new Set(events.filter((x) => !isProbe(pb, x.body) && x.body[field] !== undefined && x.body[field] !== null).map((x) => String(x.body[field])));
  return [
    ...pb.dimension.values.filter((v) => !seen.has(v)).map((v) => `no order events for ${pb.dimension.name}=${v} in the last 10m`),
    ...[...seen].filter((v) => !pb.dimension.values.includes(v)).map((v) => `order events have ${pb.dimension.name}=${v}, which is not in dimension.values`),
  ];
}

export async function readiness(db: Database, pb: Playbook, fresh = false) {
  const key = `${pb.id}@${pb.version}`;
  let c = cache.get(key);
  if (fresh || !c || Date.now() - c.at > FLAGSMITH_TTL_MS) {
    const reasons = flagsmithReasons(pb).catch(() => ["Flagsmith check failed"]);
    cache.set(key, (c = { at: Date.now(), reasons }));
  }
  return readinessResult(db, pb, await c.reasons);
}

function readinessResult(db: Database, pb: Playbook, flagReasons: string[]) {
  const reasons = [...flagReasons, ...eventReasons(pb, eventsSince(db, Date.now() - READINESS_EVENTS_MS))];
  return { readiness: reasons.length ? ("broken" as const) : ("ready" as const), reasons };
}

export const draftReadiness = async (db: Database, pb: Playbook) => readinessResult(db, pb, await flagsmithReasons(pb));

export function recentEventFields(db: Database): string[] {
  return db.query<{ key: string }, [number]>(`SELECT DISTINCT field.key FROM
    (SELECT body FROM order_events WHERE received_at >= ? ORDER BY received_at DESC, id DESC LIMIT 500) AS recent,
    json_each(recent.body) AS field ORDER BY field.key`).all(Date.now() - READINESS_EVENTS_MS).map(({ key }) => key);
}

export const playbooksWithReadiness = (db: Database) =>
  Promise.all(listPlaybooks(db).map(async (pb) => ({ ...pb, ...(await readiness(db, pb)) })));

// Success / (success + error) across the selected cohorts, with probes excluded.
export function availability(playbooks: Playbook[], events: Ev[], primaryOnly = true): number | null {
  let ok = 0, total = 0;
  for (const x of events) {
    const pb = playbooks.find((p) =>
      p.dimension.values.includes(x.body[p.events.dimension_field] as string) && !isProbe(p, x.body) &&
      (!primaryOnly || Object.entries(p.events.canary_filter ?? {}).every(([k, v]) => x.body[k] === v)));
    const outcome = pb && x.body[pb.events.outcome_field];
    if (outcome === "success" || outcome === "error") {
      total++;
      if (outcome === "success") ok++;
    }
  }
  return total ? Math.round((1000 * ok) / total) / 1000 : null;
}

export async function state(db: Database) {
  const pbs = await playbooksWithReadiness(db);
  const events = eventsSince(db, Date.now() - AVAILABILITY_MS);
  const byDimension = new Map<string, Playbook[]>();
  for (const pb of pbs) {
    const name = pb.dimension.name;
    const group = byDimension.get(name) ?? [];
    group.push(pb);
    byDimension.set(name, group);
  }
  return {
    availability: availability(pbs, events),
    availabilityByDimension: Array.from(byDimension, ([dimension, group]) => ({
      dimension,
      availability: availability(group, events, false),
      primaryAvailability: availability(group, events),
    })),
    openIncidents: countOpenIncidents(db),
    playbooks: { ready: pbs.filter((p) => p.readiness === "ready").length, broken: pbs.filter((p) => p.readiness === "broken").length },
  };
}
