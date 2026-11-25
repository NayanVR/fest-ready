import type { Playbook } from "./types";

export const paymentTemplate: Omit<Playbook, "version"> = {
  id: "payment-provider-failover",
  owner: "payments-team",
  description: "A simulated payment provider outage affects customers who prefer that provider. Route their test payments to another mock provider until the primary recovers.",
  match: { alerts: ["PaymentAvailabilityLow"], cause: "external" },
  dimension: { name: "paymentCohort", trait: "paymentCohort", label: "paymentCohort", values: ["alpha", "beta", "gamma"] },
  flag: { key: "payment_primary_enabled", normal: { enabled: true }, fallback: { enabled: false } },
  segments: { fallback: "payment-{value}-fallback", recovery: "payment-{value}-recovery" },
  recovery: {
    method: "split",
    steps: [5, 10, 50, 100],
    auto_advance: false,
    guardrail: { min_samples: 10, max_error_rate: 0.05, max_consecutive_errors: 3, window: "20s" },
    cooldown_after_rollback: "60s",
  },
  events: {
    dimension_field: "paymentCohort",
    identity_field: "paymentCustomer",
    outcome_field: "paymentOutcome",
    amount_field: "amount",
    canary_filter: { paymentRoute: "primary" },
  },
  probe: {
    every: "10s",
    healthy_for: "60s",
    identities: { alpha: "pay-probe-alpha", beta: "pay-probe-beta", gamma: "pay-probe-gamma" },
    request: {
      method: "POST",
      url: "${SHOP_URL}/api/payments",
      body: { provider: "{value}", customerId: "{probe_identity}", amount: 1000, synthetic: true },
    },
    expect: { healthy: { status: 201 }, fallback_active: { status: 409 } },
  },
};
