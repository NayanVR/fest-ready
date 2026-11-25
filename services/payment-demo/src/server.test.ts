import { afterEach, beforeEach, expect, test } from "bun:test";
import { createPaymentDemo } from "./server.ts";

let server: ReturnType<typeof Bun.serve>;
const adminSecret = crypto.randomUUID();
const adminKey = crypto.randomUUID();
const project = "/api/v1/projects/1";
const versions = "/api/v1/environments/1/features/1/versions/";

beforeEach(() => {
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createPaymentDemo({ adminSecret, adminKey }) });
});

afterEach(() => server.stop(true));

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(new URL(path, server.url), {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function admin(path: string, method = "GET", body?: unknown) {
  return request(path, method, body, { Authorization: `Api-Key ${adminKey}` });
}

function outage(provider: string, status: 503 | null) {
  return request("/admin/outage", "POST", { provider, status }, { "X-Admin-Secret": adminSecret });
}

function payment(provider: string) {
  return request(`/providers/${provider}/payments`, "POST", { paymentId: "test-payment", amount: 500 });
}

async function primary(provider: string, customerId = "customer-1") {
  const query = new URLSearchParams({ provider, customerId });
  const response = await request(`/routing?${query}`);
  expect(response.status).toBe(200);
  const { primaryEnabled } = await response.json();
  expect(typeof primaryEnabled).toBe("boolean");
  return primaryEnabled as boolean;
}

async function segmentPath(name: string) {
  const { results } = await (await admin(`${project}/segments/?q=${name}`)).json();
  const { id } = results.find((segment: { name: string }) => segment.name === name);
  return `${project}/segments/${id}/`;
}

function updateOverride(segment: number, enabled: boolean) {
  return {
    feature_segment: { segment },
    enabled,
    feature_state_value: { type: "unicode", string_value: null },
  };
}

function publish(...updates: ReturnType<typeof updateOverride>[]) {
  return admin(versions, "POST", {
    publish_immediately: true,
    description: "Operator-approved fixture change",
    feature_states_to_update: updates,
  });
}

async function setSplit(path: string, percent: number) {
  const { name, rules } = await (await admin(path)).json();
  rules[0].conditions.find((condition: { operator: string }) => condition.operator === "PERCENTAGE_SPLIT").value = String(percent);
  expect((await admin(path, "PUT", { name, rules })).status).toBe(200);
  const readBack = await (await admin(path)).json();
  expect(readBack.rules).toEqual(rules);
}

test("isolates a provider outage and keeps the preferred route until approval", async () => {
  const health = await request("/healthz");
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  expect((await payment("alpha")).status).toBe(201);
  expect((await outage("alpha", 503)).status).toBe(200);
  expect(await (await request("/status")).json()).toEqual({
    providers: [
      { id: "alpha", available: false },
      { id: "beta", available: true },
      { id: "gamma", available: true },
    ],
  });
  expect(await primary("alpha")).toBe(true);
  const failed = await payment("alpha");
  expect(failed.status).toBe(503);
  expect((await failed.json()).error).toBe("PROVIDER_UNAVAILABLE");
  for (const provider of ["beta", "gamma"]) {
    const healthy = await payment(provider);
    expect(healthy.status).toBe(201);
    expect(await healthy.json()).toEqual({ provider, paymentId: "test-payment" });
  }
  expect((await outage("alpha", null)).status).toBe(200);
  expect((await payment("alpha")).status).toBe(201);
});

test("reads back an approval and changes only the selected cohort, with stable recovery splits", async () => {
  const features = await (await admin(`${project}/features/?search=payment_primary`)).json();
  expect(features.results).toEqual([{ name: "payment_primary_enabled", id: 1 }]);
  const fallback = await segmentPath("payment-alpha-fallback");
  const recovery = await segmentPath("payment-alpha-recovery");
  const { id } = await (await admin(fallback)).json();
  const before = await (await admin(versions)).json();
  expect((await outage("alpha", 503)).status).toBe(200);
  const approval = await publish(updateOverride(id, false));
  expect(approval.status).toBe(201);
  const { uuid } = await approval.json();
  const { results } = await (await admin(versions)).json();
  expect(results).toEqual([{ uuid, is_live: true }, { uuid: before.results[0].uuid, is_live: false }]);
  const states = await (await admin(`${versions}${uuid}/featurestates/`)).json();
  expect(states.filter((state: { enabled: boolean }) => !state.enabled)).toEqual([
    { enabled: false, feature_segment: { segment: id, priority: 1 } },
  ]);

  const customers = Array.from({ length: 64 }, (_, index) => `customer-${index}`);
  const sample = () => Promise.all(customers.map((customerId) => primary("alpha", customerId)));
  await setSplit(recovery, 0);
  expect((await sample()).every((enabled) => !enabled)).toBe(true);
  expect((await payment("beta")).status).toBe(201);
  expect(await primary("beta")).toBe(true);
  expect(await primary("gamma")).toBe(true);
  for (const provider of ["alpha", "beta", "gamma"]) {
    expect(await primary(provider, `pay-probe-${provider}`)).toBe(true);
  }
  expect((await request("/routing?provider=beta&customerId=pay-probe-alpha")).status).toBe(400);

  await setSplit(recovery, 25);
  const first = await sample();
  expect(first).toContain(true);
  expect(first).toContain(false);
  expect(await sample()).toEqual(first);
  await setSplit(recovery, 50);
  expect((await sample()).every((enabled, index) => enabled || !first[index])).toBe(true);
  const betaFallback = await segmentPath("payment-beta-fallback");
  const { id: betaId } = await (await admin(betaFallback)).json();
  expect((await publish(updateOverride(betaId, false))).status).toBe(201);
  expect((await outage("alpha", null)).status).toBe(200);
  await setSplit(recovery, 100);
  expect((await sample()).every(Boolean)).toBe(true);
  expect((await payment("alpha")).status).toBe(201);
  expect(await primary("beta")).toBe(false);
  expect(await primary("gamma")).toBe(true);
  await setSplit(recovery, 0);
  expect((await sample()).every((enabled) => !enabled)).toBe(true);
  expect((await publish(updateOverride(id, true))).status).toBe(201);
  expect((await sample()).every(Boolean)).toBe(true);
});

test("rejects unauthenticated writes and validates fixture segment mutations atomically", async () => {
  expect((await request("/admin/outage", "POST", { provider: "alpha", status: 503 })).status).toBe(401);
  expect((await request(versions)).status).toBe(401);
  expect((await request(versions, "POST", {}, { Authorization: `Token ${adminKey}` })).status).toBe(401);
  expect((await payment("alpha")).status).toBe(201);

  const fallback = await segmentPath("payment-alpha-fallback");
  const recovery = await segmentPath("payment-alpha-recovery");
  const { id } = await (await admin(fallback)).json();
  expect((await publish(updateOverride(id, false), updateOverride(999, false))).status).toBe(400);
  expect(await primary("alpha")).toBe(true);

  const { name, rules } = await (await admin(recovery)).json();
  rules[0].conditions[1].value = "101";
  expect((await admin(recovery, "PUT", { name, rules })).status).toBe(400);
  rules[0].conditions[1].value = "100";
  rules[0].conditions[0].value = "beta";
  expect((await admin(recovery, "PUT", { name, rules })).status).toBe(400);
  expect((await admin(`${project}/segments/999/`, "PUT", { name, rules })).status).toBe(404);
  expect((await (await admin(recovery)).json()).rules[0].conditions[1].value).toBe("0");
});
