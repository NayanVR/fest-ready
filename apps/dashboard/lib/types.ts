// Shapes from docs/CONTRACTS.md §3.4 (incident detail) and §8 (playbook).
export type Findings = {
  source: string; cause: string; summary: string; nubiUrl?: string | null;
  evidence?: string[]; submittedAt?: string;
};
export type Recovery = {
  state: string; splitPercent: number; observedSharePercent: number | null;
  samples: number; minSamples: number; errorRate: number | null; maxErrorRate: number;
  consecutiveErrors: number; guardrail: string; advanceAllowed: boolean; reason?: string | null; autoAdvance?: boolean;
};
export type Incident = {
  id: string; title: string; status: string; owner: string | null; alert: string;
  playbook: string | null; value: string | null; findings: Findings | null;
  openedAt: string | null; mitigatedAt: string | null; resolvedAt: string | null; closedAt: string | null;
  recovery: Recovery | null;
  probe: { healthy: boolean; healthySince: string | null; healthyFor: string | null; last: boolean[] } | null;
  impact: {
    ordersFailed: number; amountFailed: number; ordersSaved: number; amountSaved: number;
    atRiskPerMinute: number; customersAffected: number;
  } | null;
  closeNote?: string | null;
  timeline: { ts: string; actor: string; action: string; result: string }[];
};
export const SARVAM_VOICE_LANGUAGES = [
  "Assamese", "Bengali", "English", "Gujarati", "Hindi", "Kannada", "Malayalam",
  "Marathi", "Odia", "Punjabi", "Sanskrit", "Tamil", "Telugu",
] as const;
export type SarvamVoiceLanguage = (typeof SARVAM_VOICE_LANGUAGES)[number];
export type Playbook = {
  id: string; version: number; owner: string; description: string;
  match: { alerts: string[]; cause: "external" | "internal" };
  dimension: { name: string; trait: string; label: string; values: string[] };
  flag: {
    key: string;
    normal: { enabled: boolean; value?: string | number };
    fallback: { enabled: boolean; value?: string | number };
  };
  segments: { fallback: string; recovery: string };
  recovery: {
    method: "split" | "segments";
    steps: number[];
    auto_advance?: boolean;
    guardrail: { min_samples: number; max_error_rate: number; max_consecutive_errors: number; window: string };
    cooldown_after_rollback: string;
  };
  approval_call?: { phone_number: string; delay_minutes: number; language: SarvamVoiceLanguage };
  events: {
    dimension_field: string; identity_field: string; outcome_field: string; amount_field?: string;
    canary_filter?: Record<string, unknown>;
  };
  health?: { errors: string; total: string };
  probe: {
    every: string; healthy_for: string; identities: Record<string, string>;
    request: { method: string; url: string; body?: unknown };
    expect: { healthy: { status: number }; fallback_active: { status: number } };
  };
};

// "Other read shapes" in CONTRACTS.md §3.4.
export type State = {
  availability: number | null;                  // fraction 0..1, null if no events
  availabilityByDimension?: { dimension: string; availability: number | null; primaryAvailability: number | null }[];
  openIncidents: number;
  playbooks: { ready: number; broken: number };
};
export type IncidentRow = Pick<Incident,
  "id" | "title" | "status" | "owner" | "alert" | "playbook" | "value" | "openedAt" | "closedAt">;
export type PlaybookRow = Playbook & { readiness: "ready" | "broken"; reasons: string[] };
export type FlagState = { fallbackActive: boolean; fallbackEnabled: boolean; fallbackValue: string | null; splitPercent: number } | null; // CONTRACTS §3.4
export type AuditRow = {
  ts: string; incidentId: string | null; actor: string; action: string;
  before: FlagState; after: FlagState; readBack: FlagState; result: string;
};
export type FaultResult = { ok: true; provider: string; outage: boolean };
export type Evidence = {
  value: string; from: string; to: string; failedAttempts: number; customersAffected: number;
  byOutcome: Record<string, number>; rows: unknown[];
};
