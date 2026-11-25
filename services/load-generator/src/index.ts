import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

async function run() {
  const shopUrl = new URL(process.env.SHOP_URL || "http://localhost:4001");
  if (shopUrl.protocol !== "http:" && shopUrl.protocol !== "https:") {
    throw new Error("SHOP_URL must use HTTP or HTTPS");
  }
  const optionsUrl = new URL("/api/options", shopUrl);
  const ordersUrl = new URL("/api/orders", shopUrl);
  const rate = numberFromEnv("RATE_PER_SEC", 20, 1000 / 2_147_483_647, 1000);
  const durationMs = 1000 * numberFromEnv("DURATION_SEC", 3600, 0.001, Number.MAX_SAFE_INTEGER / 1000);
  const deliveryRatio = numberFromEnv("DELIVERY_RATIO", 0.7, 0, 1);
  const cities = [
    { city: "bengaluru", prefix: "blr" },
    { city: "mumbai", prefix: "mum" },
    { city: "delhi", prefix: "del" },
  ].map((city) => ({ ...city, delivery: 0, pickup: 0, success: 0, rejected: 0, error: 0 }));

  const requestId = randomUUID();
  function summarize(final: boolean) {
    for (const { city, delivery, pickup, success, rejected, error } of cities) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        service: "load-generator",
        level: "info",
        request_id: requestId,
        synthetic: true,
        final,
        city,
        delivery,
        pickup,
        success,
        rejected,
        error,
      }));
    }
  }

  async function placeOrder(city: (typeof cities)[number]) {
    const customerId = `cust-${city.prefix}-${String(randomInt(2, 501)).padStart(4, "0")}`;
    const url = new URL(optionsUrl);
    url.searchParams.set("customerId", customerId);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status !== 200) {
        await response.body?.cancel();
        city.error++;
        return;
      }
      const { options } = await response.json();
      if (!Array.isArray(options) || !options.includes("pickup")) {
        city.error++;
        return;
      }
      const mode = options.includes("delivery") && Math.random() < deliveryRatio ? "delivery" : "pickup";
      city[mode]++;
      const order = await fetch(ordersUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, mode, amount: randomInt(300, 5001), synthetic: true }),
        signal: AbortSignal.timeout(5000),
      });
      await order.arrayBuffer();
      if (order.status === 201) city.success++;
      else if (order.status === 409) city.rejected++;
      else city.error++;
    } catch {
      city.error++;
    }
  }

  const started = performance.now();
  const deadline = started + durationMs;
  const interval = 1000 / rate;
  const pending = new Set<Promise<void>>();
  const summaryTimer = setInterval(() => summarize(false), 10_000);
  let next = started;
  let index = 0;
  while (true) {
    const wait = Math.min(next, deadline) - performance.now();
    if (wait > 0) await delay(Math.ceil(wait));
    const now = performance.now();
    if (now >= deadline) break;
    if (now < next) continue;

    const order = placeOrder(cities[index % cities.length]);
    index++;
    pending.add(order);
    void order.then(() => pending.delete(order));
    // Skip missed slots after a stall to avoid sending a catch-up burst.
    next += Math.max(1, Math.floor((now - next) / interval) + 1) * interval;
  }

  clearInterval(summaryTimer);
  await Promise.all(pending);
  summarize(true);
}

try {
  await run();
} catch (error) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "load-generator",
    level: "error",
    request_id: randomUUID(),
    synthetic: true,
    error: String(error),
  }));
  process.exitCode = 1;
}
