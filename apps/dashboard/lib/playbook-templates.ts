import type { Playbook } from "./types";

const pauseRoute: Omit<Playbook, "version"> = {
  id: "", owner: "", description: "",
  match: { alerts: [], cause: "external" },
  dimension: { name: "", trait: "", label: "", values: [] },
  flag: { key: "", normal: { enabled: true }, fallback: { enabled: false } },
  segments: { fallback: "", recovery: "" },
  recovery: {
    method: "split", steps: [5, 10, 50, 100], auto_advance: false,
    guardrail: { min_samples: 10, max_error_rate: 0.05, max_consecutive_errors: 3, window: "20s" },
    cooldown_after_rollback: "60s",
  },
  events: { dimension_field: "", identity_field: "", outcome_field: "" },
  probe: {
    every: "10s", healthy_for: "60s", identities: {},
    request: { method: "POST", url: "${SHOP_URL}/api/orders" },
    expect: { healthy: { status: 201 }, fallback_active: { status: 409 } },
  },
};

export const playbookTemplates = [
  {
    title: "Pause a route",
    description: "Disable a flag for the affected cohort, then restore it in percentage steps.",
    draft: pauseRoute,
  },
  {
    title: "Enable a fallback route",
    description: "Turn on a backup flag for the affected cohort, then phase the backup out as the primary recovers.",
    draft: { ...pauseRoute, flag: { key: "", normal: { enabled: false }, fallback: { enabled: true } } },
  },
];
