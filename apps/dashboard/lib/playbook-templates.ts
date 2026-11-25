import type { Playbook } from "./types";

// Platform-safe defaults: every value sits inside the CONTRACTS §8 limits.
const pauseRoute: Omit<Playbook, "version"> = {
  id: "", owner: "",
  description: "When the alert fires for some cohorts, pause this route for those cohorts only. Everyone else keeps the normal route.",
  match: { alerts: [], cause: "external" },
  dimension: { name: "", trait: "", label: "", values: [] },
  flag: { key: "", normal: { enabled: true }, fallback: { enabled: false } },
  segments: { fallback: "{value}-fallback", recovery: "{value}-recovery" },
  recovery: {
    method: "split", steps: [5, 10, 50, 100], auto_advance: true,
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
    description: "Turn a feature off for the affected cohorts, then bring it back in steps.",
    draft: pauseRoute,
  },
  {
    title: "Switch to a backup route",
    description: "Turn a backup on for the affected cohorts, then phase it out as the primary recovers.",
    draft: {
      ...pauseRoute,
      description: "When the alert fires for some cohorts, switch those cohorts to the backup route. Everyone else keeps the primary.",
      flag: { key: "", normal: { enabled: false }, fallback: { enabled: true } },
    },
  },
];
