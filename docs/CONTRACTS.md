# Contracts

> The interfaces Yashasvi (A) and Nayan (B) both code against. Agree on this file together in the first 30 minutes, then code apart.
> **Rule:** a change to this file needs the other person's OK, said out loud or in chat, before it's merged.
> All pre-event checks are done and recorded here; only the PromQL health path in `ARCHITECTURE.md` §9.3 is unverified. Names that external setup (Flagsmith, NudgeBee) depends on are listed in `WORK.md` → "Names that must not change"; don't rename them.
> **v3 (25 Nov):** playbook field `recovery.auto_advance` (§8); the controller itself may advance canary steps (actor `controller`); `recovery` gains `reason` and `autoAdvance`, incident gains `closeNote`; dashboard sessions set `actor` (§3.4). **Yashasvi to confirm.**
>
> **v2 (24 Nov):**
> - Three providers in partner-mock; courier-service merged into shop-api; `GET /api/customers` removed.
> - New alert `DeliveryAvailabilityLow`.
> - Findings arrive over MCP; new playbook schema stored in the controller database.
> - Probe, impact and evidence added; controller Kubernetes RBAC removed.

Owners: **A = Yashasvi** (business services + cluster) · **B = Nayan** (controller + dashboard + Flagsmith). See [`WORK.md`](WORK.md).

---

## 1. Services, ports and names

All services: Bun 1.x + TypeScript, listen on `PORT`, log JSON to stdout, expose `GET /healthz` → `200 {"ok":true}`.

| Service | Owner | Local dev (`bun run dev`) | In cluster | Reached from the Mac |
|---|---|---|---|---|
| shop-api | A | `http://localhost:4001` | `http://shop-api.shop` (svc port 80) | NodePort 30401 → `localhost:4001` |
| partner-mock | A | `http://localhost:4003` | `http://partner-mock.providers` (svc port 80) | — (Makefile uses `kubectl exec`) |
| load-generator | A | (CLI, no port) | Deployment in `shop`, scaled 0 or 1 | — |
| controller | B | `http://localhost:4100` | `http://controller.shop` | NodePort 30410 → `localhost:4100` |
| dashboard | B | `http://localhost:3000` | `http://dashboard.shop` | NodePort 30300 → `localhost:3000` |
| Prometheus | A | — | `http://kube-prometheus-stack-prometheus.monitoring.svc:9090` (verified) | port-forward → `localhost:9090` (debug only) |
| Grafana | A | — | in `monitoring` | NodePort 30301 → `localhost:3001` |

- Namespaces: `shop`, `providers`, `monitoring`, `nudgebee`.
- The Mac-side ports come from KinD `extraPortMappings` in `infra/kind/cluster.yaml` (A).
- Ports 5000 and 7000 are off limits on macOS (AirPlay).
- Images: `<service>:dev`, `imagePullPolicy: IfNotPresent`, loaded with `kind load docker-image`.

---

## 2. Customers and providers

No shared seed file and no database. Everyone generates the same IDs from this rule:

| City | Prefix | IDs | Provider |
|---|---|---|---|
| bengaluru | `blr` | `cust-blr-0001` … `cust-blr-0500` | `a` |
| mumbai | `mum` | `cust-mum-0001` … `cust-mum-0500` | `b` |
| delhi | `del` | `cust-del-0001` … `cust-del-0500` | `c` |

- `city` values are always lowercase full names: `bengaluru`, `mumbai`, `delhi`. Provider values are `a`, `b`, `c`.
- shop-api is the only service that maps an ID to a city (regex `^cust-(blr|mum|del)-(\d{4})$`, number 0001–0500) and a city to a provider. Clients send only `customerId`.
- `cust-<prefix>-0001` is reserved for the controller's probe orders. The load generator uses `0002`–`0500`.
- The dashboard storefront uses a fixed list of demo IDs; there is no customer-list endpoint.

---

## 3. HTTP APIs

All bodies are JSON. Errors always look like `{"error":"CODE","message":"human text"}` plus any extra fields listed.

### 3.1 shop-api (A) — used by the dashboard storefront, load-generator and controller probe

**`GET /api/options?customerId=cust-mum-0142`**
```json
200 {"customerId":"cust-mum-0142","city":"mumbai","options":["delivery","pickup"],
     "flags":{"home_delivery_enabled":true}}
404 {"error":"UNKNOWN_CUSTOMER","message":"..."}
```

**`POST /api/orders`** body `{"customerId":"cust-mum-0142","mode":"delivery","amount":1499,"synthetic":true}`
```json
201 {"orderId":"o-8812","customerId":"cust-mum-0142","city":"mumbai","mode":"delivery",
     "provider":"b","amount":1499,"outcome":"success","latencyMs":143}
409 {"error":"DELIVERY_UNAVAILABLE","message":"Home delivery is paused in your city. Pickup is available.",
     "outcome":"rejected"}
502 {"error":"PROVIDER_FAILED","message":"The courier provider couldn't take the order. Try pickup.",
     "outcome":"error","provider":"b","upstreamStatus":500}
404 {"error":"UNKNOWN_CUSTOMER","message":"..."}
400 {"error":"BAD_REQUEST","message":"..."}
```
- `mode` is `delivery` | `pickup`. `amount` is an integer in ₹, 1–100000, default 1000. `synthetic` defaults to `true`.
- `provider` appears only for delivery. `upstreamStatus` is the provider's HTTP status, or `"timeout"` after 2 s.
- Pickup orders never call a provider.
- After every order (any outcome), shop-api sends the order event in §3.4 to the controller. Best effort: 500 ms timeout, errors ignored, skipped if `CONTROLLER_URL` is unset.

### 3.2 partner-mock (A) — used by shop-api, the controller (demo button) and the Makefile

**`POST /{a|b|c}/shipments`** body `{"orderId":"o-8812","city":"mumbai"}`
```json
200 {"ref":"b-55"}
500 {"error":"PROVIDER_UNAVAILABLE","message":"..."}     // only while that provider has an outage
404 {"error":"UNKNOWN_PROVIDER","message":"..."}
```

**`POST /admin/outage`** header `X-Admin-Secret: $ADMIN_SECRET`
body `{"provider":"b","status":500}` to start · `{"provider":"b","status":null}` to clear
```json
200 {"outages":{"b":500}}
401 {"error":"UNAUTHORIZED","message":"..."}
```
- Outage state lives in memory and resets on restart. No city logic, no API keys.
- Logs every request as JSON with `provider` and `status`.

### 3.3 (removed) courier-service
Merged into shop-api.

### 3.4 controller (B)

Read endpoints are open inside the cluster. **Write endpoints (🔒) need header `X-Admin-Secret: $ADMIN_SECRET`.** The dashboard adds it in a Next.js server route; the browser never sees it. The dashboard itself needs a login (seed account `admin`/`admin`, sign-up allowed); its server route overwrites `actor` (and `owner` on ack) in every write body with the logged-in username, so the browser can't choose its audit name. Every page, `/api/c` and `/api/shop` need a session; `/healthz` stays open.

| Method + path | Caller | Purpose |
|---|---|---|
| `POST /internal/orders` | shop-api | Order event (below). No secret; internal only |
| `POST /webhooks/alertmanager` | Alertmanager | Opens an incident in Investigating, or reopens the open one. Body: standard Alertmanager webhook payload (version 4) |
| `POST /mcp` | NudgeBee (NuBi) | MCP server, tools in §3.5 |
| `GET /api/state` | dashboard | Overall delivery availability, open incident summary, playbook readiness. **No per-value breakdown** |
| `GET /api/incidents` | dashboard | Ticket list, newest first |
| `GET /api/incidents/:id` | dashboard | Ticket, findings, recovery, impact, probe, timeline (shape below) |
| `POST /api/incidents/:id/ack` | dashboard 🔒 | Take ownership `{"owner":"name"}` |
| `POST /api/incidents/:id/findings` | dashboard 🔒 | Safety-net findings form. Same body and validation as `submit_findings`, plus `"source":"operator"` |
| `POST /api/incidents/:id/approve` | dashboard 🔒 | Apply the fallback for the validated findings `{"actor":"name"}`. `409 NO_FINDINGS` if none |
| `POST /api/incidents/:id/advance` | dashboard 🔒 | From PROBE_OK: start at the first step (operator only). From CANARY_n: go to the next step (operator, or the controller itself when the playbook sets `recovery.auto_advance`; the audit row then has actor `controller` and "automatic advance: guardrail passed"). `409 {"error":"GUARDRAIL_NOT_PASSED"}` unless `advanceAllowed`; `409 {"error":"PROBE_NOT_HEALTHY"}` from FALLBACK |
| `POST /api/incidents/:id/rollback` | dashboard 🔒 | Split to 0%. Body `{"actor":"name"}` (also accepted on advance and close; defaults to `operator`) |
| `POST /api/incidents/:id/close` | dashboard 🔒 | `{"note":"..."}`; note required |
| `GET /api/incidents/:id/evidence` | dashboard | Provider evidence pack. JSON by default, `?format=csv` for CSV |
| `GET /api/playbooks` | dashboard | All playbooks with readiness (`ready` \| `broken` + reasons) |
| `GET /api/playbooks/:id` | dashboard | One playbook (§8 schema) |
| `POST /api/playbooks` | dashboard 🔒 | Create. `422 INVALID_PLAYBOOK` with `reasons[]`. Stretch (B7); without it, playbooks change only via the seed YAML + DB reset |
| `PUT /api/playbooks/:id` | dashboard 🔒 | Update (bumps `version`). Same validation. Stretch (B7) |
| `POST /api/playbooks/:id/check` | dashboard 🔒 | Run the readiness check now |
| `POST /api/fault` | dashboard 🔒 | Demo only: `{"action":"outage"\|"clear","provider":"b"}` → partner-mock `/admin/outage` |
| `GET /api/audit?incident=INC-0042` | dashboard | Audit rows |

**Order event** (`POST /internal/orders`, sent by shop-api):
```json
{"orderId":"o-8812","customerId":"cust-mum-0142","city":"mumbai","mode":"delivery","provider":"b",
 "deliveryFlag":true,"outcome":"error","errorCode":"PROVIDER_FAILED","upstreamStatus":500,
 "amount":1499,"latencyMs":143,"synthetic":true,"ts":"2026-11-25T11:03:00+05:30"}
```
- `outcome` is `success` | `error` | `rejected`, the same as the metric label.
- `provider` and `upstreamStatus` are `null` for pickup.
- The controller stores events as they arrive and reads them through the playbook's `events` field names (§8). It never hard-codes these field names.

**`GET /api/incidents/:id`** response shape:
```json
{"id":"INC-0042","title":"Delivery failures in mumbai","status":"Recovering","owner":"name",
 "alert":"DeliveryAvailabilityLow","playbook":"city-delivery-fallback","value":"mumbai",
 "findings":{"source":"nubi","cause":"external","summary":"<verbatim>","nubiUrl":"https://...",
             "evidence":["..."],"submittedAt":"..."},
 "openedAt":"...","mitigatedAt":"...","resolvedAt":null,"closedAt":null,"closeNote":null,
 "recovery":{"state":"CANARY_10","splitPercent":10,"observedSharePercent":9.6,
             "samples":34,"minSamples":20,"errorRate":0.009,"maxErrorRate":0.05,
             "consecutiveErrors":0,"guardrail":"pass","advanceAllowed":true,
             "reason":null,"autoAdvance":true},
 "probe":{"healthy":true,"healthySince":"...","healthyFor":"5m","last":[true,true,false]},
 "impact":{"ordersFailed":163,"amountFailed":211000,"ordersSaved":241,"amountSaved":318000,
           "atRiskPerMinute":9000,"customersAffected":143},
 "timeline":[{"ts":"...","actor":"controller","action":"split 5% → 10%","result":"ok"}]}
```
- Before findings: `playbook`, `value` and `findings` are `null`, `recovery`, `probe` and `impact` are `null`, and the title is generic.
- `impact` only counts events for the incident's value.
- `recovery.reason` is the controller's text for why advance is not allowed (or the breach text), else `null`. `recovery.autoAdvance` is the playbook's `recovery.auto_advance`. `closeNote` is the note given at close.

**Other read shapes** (added 24 Nov; both sides are B):
```text
GET /api/state       {"availability":0.982,             // fraction 0..1 over the last 5 min, all values together; null if no events
                      "openIncidents":1,
                      "playbooks":{"ready":1,"broken":0}}
GET /api/incidents   [{"id","title","status","owner","alert","playbook","value","openedAt","closedAt"}]   // newest first
GET /api/playbooks   [{...§8 playbook, "readiness":"ready"|"broken", "reasons":["..."]}]
GET /api/audit       [{"ts","incidentId","actor","action","before","after","readBack","result"}]          // newest first; before/after/readBack are flag-state objects or null
                     flag state: {"fallbackActive":bool,"fallbackEnabled":bool,"fallbackValue":string|null,"splitPercent":int}
POST /api/fault      200 {"ok":true,"provider":"b","outage":true|false}; 502 {"error":"PARTNER_UNREACHABLE"}
```
- Errors everywhere: `{"error":"CODE","message":"..."}`.
- `synthetic` does not filter anything (all demo orders are synthetic). Probe orders are recognised by the playbook's `probe.identities` (the load generator never uses ID 0001); they are stored but left out of availability, the guardrail and impact.

### 3.5 MCP tools (B implements; NuBi calls)

Transport: MCP **Streamable HTTP**, stateless, JSON responses, at `POST /mcp` (verified with NudgeBee 1.14). No admin secret is needed. It's reachable only inside the cluster; NudgeBee reaches it through its **proxy agent** (forager) with connection mode *Proxy Agent*, URL `http://controller.shop/mcp`.

**`list_playbooks()`** → the catalog
```json
[{"id":"city-delivery-fallback","description":"Home delivery fails for one city because ...",
  "cause":"external","alerts":["DeliveryAvailabilityLow"],
  "dimension":"city","values":["bengaluru","mumbai","delhi"]}]
```

**`submit_findings({playbook, value, cause, summary, evidence})`**
- Tool description: *"Call this once your investigation is done. Choose the playbook from `list_playbooks` whose description matches the failure, and a value from its allowed values. Use `playbook: null` if no playbook fits or the cause is our own change. `summary` is your findings in 3–5 sentences."*
- Input: `playbook` (string \| null), `value` (string \| null), `cause` (`external` \| `internal`), `summary` (string, ≤ 2000 chars), `evidence` (string[], optional), `nubiUrl` (string, optional).
- It attaches to the newest Investigating incident whose alert is in the playbook's `match.alerts` (or the newest Investigating incident when `playbook` is null).
- Validation, in order:
  1. there is an open incident (`NO_OPEN_INCIDENT`);
  2. the playbook exists (`UNKNOWN_PLAYBOOK`);
  3. the value is in `dimension.values` (`VALUE_NOT_ALLOWED`);
  4. the cause equals `match.cause` (`CAUSE_MISMATCH`);
  5. the incident alert is in `match.alerts` (`ALERT_MISMATCH`).
- Result: `{"accepted":true,"incident":"INC-0042"}` or `{"accepted":false,"error":"VALUE_NOT_ALLOWED","message":"pune is not in [bengaluru, mumbai, delhi]"}`, which NuBi can read and correct.
- The controller stores `summary` **verbatim** and never edits it.

---

## 4. Metrics, logs and alert (A emits; B, Prometheus and NuBi read)

Library: `prom-client`. shop-api and partner-mock expose `GET /metrics`.

| Metric | Type | Labels and allowed values | Emitted by |
|---|---|---|---|
| `shop_orders_total` | counter | `city`, `mode`=delivery\|pickup, `result`=success\|error\|rejected | shop-api |
| `shop_delivery_flag_evaluations_total` | counter | `city`, `value`=true\|false | shop-api |
| `courier_dispatch_total` | counter | `city`, `provider`=a\|b\|c, `status`=200\|500\|timeout | shop-api |
| `courier_dispatch_duration_seconds` | histogram | `city`, `provider`; buckets 0.05, 0.1, 0.25, 0.5, 1, 2 | shop-api |
| `partner_requests_total` | counter | `provider`, `status` | partner-mock |

- Never put `customerId` or `orderId` in a label.
- Scraped through one `ServiceMonitor` per service (A) with label `release: kube-prometheus-stack` (verified).

**Logs:** one JSON object per line on stdout, with at least `ts`, `service`, `level`, `request_id`, plus `order_id`, `city`, `provider`, `status`, `error` when they apply, and `"synthetic":true`. Example in `ARCHITECTURE.md` §6.

**Alert** (A, `PrometheusRule`):
```yaml
- alert: DeliveryAvailabilityLow
  expr: |
    sum(rate(shop_orders_total{mode="delivery",result="error"}[1m]))
      / sum(rate(shop_orders_total{mode="delivery",result=~"success|error"}[1m])) > 0.05
  for: 1m
```
No `city` or `provider` label on the alert.

**Alertmanager routing** (A): child routes with `continue: true`, never a root receiver:
```yaml
route:
  routes:
    - { receiver: nudgebee,   matchers: [alertname="DeliveryAvailabilityLow"], continue: true }
    - { receiver: controller, matchers: [alertname="DeliveryAvailabilityLow"] }
receivers:
  - { name: nudgebee,   webhook_configs: [{ url_file: <secret monitoring/nudgebee-webhook> }] }   # = http://nudgebee-agent-runner.nudgebee.svc/api/alerts (verified)
  - { name: controller, webhook_configs: [{ url: "http://controller.shop/webhooks/alertmanager", send_resolved: true }] }
```

---

## 5. Flagsmith (B sets up; A's shop-api reads)

| Item | Value |
|---|---|
| Flag | `home_delivery_enabled`, boolean, default on |
| Identity | `customerId` |
| Trait | `city` (set by shop-api from the customer ID, on every call) |
| Segments | For each of bengaluru, mumbai, delhi: `{city}-recovery` (higher priority, `city == {city}` AND `% Split <= N`, N starts at 0, override enabled=true) and `{city}-fallback` (lower priority, `city == {city}`, override enabled=true, which equals the default and so has no effect) |
| Fallback on/off | The `{city}-fallback` override **always exists**. "Fallback on" = set its state to the playbook's `flag.fallback` (`enabled: false`); "fallback off" = set it to `flag.normal` (`enabled: true`). We never create or delete overrides at runtime |
| SDK mode in shop-api | Local evaluation, refresh every 5 s. Verified (check 9): an Admin API change reached the SDK in ~7 s |
| Probe identities | `cust-blr-0001`, `cust-mum-0001`, `cust-del-0001` have a Flagsmith **identity override** `home_delivery_enabled = on` (set once, 24 Nov). Identity overrides beat segments, so the probe keeps reaching the provider while its city is in fallback. Verified with local evaluation: Mumbai fallback on → probe on, other Mumbai 0/199. No other client (load generator, storefront) may use ID 0001 |
| Who writes flags | Only the controller (Admin API). shop-api never writes |
| Recovery method | Edit N on the one `{value}-recovery` segment |

**Setup (done 24 Nov, check 7 passed):** project `festive-rush` (55637), environment `demo` (id 119210). The environment uses **v2 feature versioning**, so override changes go through feature versions. Test with 200 identities per city, Mumbai fallback on: Mumbai 0/200 on and other cities 200/200. N=5 → 5/200, N=10 → 16/200 (contains all of N=5), N=50 → 88/200. The split applies only inside Mumbai.

**Quota (check 11):** free plan, `max_api_calls` 50,000/month. If each environment-document poll counts (the docs list it as a tracked request type but don't say it counts toward the plan limit), one shop-api polling every 5 s uses ~17k/day. Run shop-api only while testing; raise the refresh interval if usage gets close.

**Admin API calls** (verified with check 8, 24 Nov; base `https://api.flagsmith.com/api/v1`):
```text
Auth header:                              Authorization: Api-Key <FLAGSMITH_MGMT_TOKEN>    ("Token" → 401)
Look up feature id by name:               GET  /projects/{FLAGSMITH_PROJECT_ID}/features/?search={name}
                                          → .results[]; substring match, so filter name == exactly
Look up segment id by name:               GET  /projects/{FLAGSMITH_PROJECT_ID}/segments/?q={name}
                                          → .results[]; substring match, so filter name == exactly
Enable/disable segment override:          POST /environments/{FLAGSMITH_ENV_ID}/features/{featureId}/versions/
                                          {"publish_immediately": true, "description": "<audit text>",
                                           "feature_states_to_update": [{"feature_segment": {"segment": <segmentId>},
                                             "enabled": <bool>, "feature_state_value": {"type": "unicode", "string_value": null}}]}
                                          → 201, a new live version
Set % split N on a segment's rules:       GET  /projects/{FLAGSMITH_PROJECT_ID}/segments/{segmentId}/
                                          then PUT the same path with {"name", "rules"}, where the condition with
                                          operator "PERCENTAGE_SPLIT" has "value": "<N>" (a string). Keep rule and condition ids. → 200
Read back current state:                  N:          GET /projects/{FLAGSMITH_PROJECT_ID}/segments/{segmentId}/ → PERCENTAGE_SPLIT value
                                          overrides:  GET /environments/{FLAGSMITH_ENV_ID}/features/{featureId}/versions/
                                                      → the first result with is_live == true (newest first), then
                                                      GET .../versions/{uuid}/featurestates/ → [{enabled, feature_segment: {segment, priority}}]
Set a flag value in a segment override:   same versions POST, with feature_state_value {"type": "unicode", "string_value": "<v>"}
                                          (not exercised; value-type playbooks only)
```

---

## 6. Kubernetes objects

| Object | Namespace | Owner | Notes |
|---|---|---|---|
| Deployments + Services: shop-api, load-generator, controller, dashboard | `shop` | A creates manifests; B provides controller/dashboard Dockerfiles | NodePorts per §1 |
| Deployment + Service: partner-mock | `providers` | A | |
| Secret `app-secrets` | `shop` and `providers` | A (template) | Keys from §7; real values from `.env` |
| PersistentVolume for controller SQLite | `shop` | A | Currently `emptyDir`: **any controller restart deletes all incidents and audit rows** and re-imports the seed playbook. That is the demo reset; never restart the controller mid-demo |
| ServiceMonitors, PrometheusRule | `monitoring` | A | §4 |

The controller needs **no** Kubernetes API access. The demo fault goes through partner-mock (§3.2).

---

## 7. Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `PORT` | all | See §1 |
| `FLAGSMITH_SERVER_KEY` | shop-api | Server-side environment key (needed for local evaluation) |
| `PARTNER_URL` | shop-api, controller | `http://localhost:4003` locally; `http://partner-mock.providers` in cluster |
| `CONTROLLER_URL` | shop-api, dashboard | Optional for shop-api (order events skipped if unset); server side only in the dashboard |
| `ADMIN_SECRET` | partner-mock, controller, dashboard | Dashboard server routes only; never in the browser |
| `SHOP_URL`, `RATE_PER_SEC`, `DURATION_SEC`, `DELIVERY_RATIO` | load-generator | Defaults 20, 3600, 0.7 (20/s gives enough canary samples for ~1 min steps) |
| `FLAGSMITH_MGMT_TOKEN`, `FLAGSMITH_PROJECT_ID`, `FLAGSMITH_ENV_ID` | controller | Never anywhere else. Other IDs are looked up by name from the playbook |
| `PROMETHEUS_URL` | controller | Optional; health falls back to order events |
| `SHOP_URL` | controller, dashboard | Probe target; storefront |
| `PLAYBOOK_DIR` | controller | Seed YAML, default `./playbooks` |
| `DB_PATH` | controller | SQLite file, default `./data/controller.db` |
| `DEMO_PROVIDERS` | dashboard | `a,b,c` for the demo controls panel |

`.env.example` lists all of them with empty values. Real `.env` is shared by AirDrop and is git-ignored.

---

## 8. Playbooks (B implements; the business writes them)

Stored in the controller's SQLite database. On first start with an empty database, the controller imports `PLAYBOOK_DIR/*.yaml`. After that, the API in §3.4 is the only way to change them. YAML and the API's JSON have the same shape.

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | ✓ | `^[a-z0-9-]+$`, unique |
| `version` | int | set by controller | Bumped on every update |
| `owner` | string | ✓ | |
| `description` | string | ✓ | Written for NuBi; returned by `list_playbooks` |
| `match.alerts` | string[] | ✓ | Alert names this playbook may be proposed for |
| `match.cause` | `external` \| `internal` | ✓ | |
| `dimension.name` | string | ✓ | |
| `dimension.trait` | string | ✓ | Flagsmith trait |
| `dimension.label` | string | ✓ | Prometheus label |
| `dimension.values` | string[] | ✓ | Non-empty, unique |
| `flag.key` | string | ✓ | Must exist in Flagsmith (readiness) |
| `flag.normal` / `flag.fallback` | `{enabled: bool, value?: string\|number}` | ✓ | Must differ |
| `segments.fallback` / `segments.recovery` | string | ✓ | Must contain `{value}` |
| `recovery.method` | `split` \| `segments` | ✓ | `segments` means pre-made `{recovery}-{step}` segments |
| `recovery.steps` | int[] | ✓ | Strictly increasing, first ≤ 10, last = 100 |
| `recovery.guardrail.min_samples` | int | ✓ | ≥ 10 |
| `recovery.guardrail.max_error_rate` | number | ✓ | 0 < x ≤ 0.2 |
| `recovery.guardrail.max_consecutive_errors` | int | ✓ | ≥ 1 |
| `recovery.guardrail.window` | duration | ✓ | e.g. `60s` |
| `recovery.cooldown_after_rollback` | duration | ✓ | |
| `recovery.auto_advance` | bool | | Default `false`. If `true`, once an operator has started recovery, the controller advances each canary step itself when its guardrail passes, through 100% to Resolved. The demo seed sets it |
| `events.dimension_field` / `identity_field` / `outcome_field` | string | ✓ | Field names in the order event |
| `events.amount_field` | string | | Enables business impact |
| `events.canary_filter` | object | | Field → value that an event must match to count for the guardrail |
| `health.errors` / `health.total` | PromQL | | May use `{value}`; used when `PROMETHEUS_URL` is set |
| `probe.every` / `probe.healthy_for` | duration | ✓ | |
| `probe.identities` | map value → identity | ✓ | One per value |
| `probe.request` | `{method, url, body}` | ✓ | May use `{probe_identity}` and `${ENV}` |
| `probe.expect.healthy` / `probe.expect.fallback_active` | `{status: int}` | ✓ | |

- **Placeholders:** only `{value}`, `{probe_identity}` and `${ENV_VAR}`.
- **Platform rules no playbook can loosen:**
  - initial fallback needs a human;
  - starting recovery (PROBE_OK → first step) needs a human; later steps advance automatically only if the playbook sets `recovery.auto_advance`, otherwise they need a human too;
  - rollback is automatic and wins over advance;
  - the numeric limits in the table above.
- **Readiness check** (`ready` \| `broken` + reasons):
  - flag exists;
  - both segments exist for every value;
  - events (or the health query) have data for every value;
  - no value appears in the events that is missing from `dimension.values`.

The demo playbook (`apps/controller/playbooks/city-delivery-fallback.yaml`) is in `ARCHITECTURE.md` §9.3.

---

## 9. Git

- One repo, branch `main`. Yashasvi (A) writes only in `services/`, `infra/` and `Makefile`; Nayan (B) only in `apps/`. Humans only: `docs/`, `AGENTS.md`, `CLAUDE.md`, `.env.example`.
- Pull before you push, push small and often. No long-lived branches today.
