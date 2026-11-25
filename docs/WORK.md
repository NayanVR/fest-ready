# Work plan — 25 Nov (event day): rebuild from scratch

> Companion to [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CONTRACTS.md`](CONTRACTS.md) and [`RUNBOOK.md`](RUNBOOK.md). Agent rules: [`/AGENTS.md`](../AGENTS.md) (Codex reads it; `CLAUDE.md` imports it for Claude Code).
> **v4 (24 Nov night):** on 24 Nov we built and rehearsed the whole demo once. **On 25 Nov all code is rewritten from scratch in a new, empty project** that starts with only these markdown files. **Kept as is (don't recreate):** Flagsmith, the NudgeBee VM and all its configuration, Sarvam and the Sarvam shim, the GCP project, `.env` (AirDrop). The few non-markdown files we still need (`infra/nudgebee/*`, `.gitignore`, `.env.example`, `CLAUDE.md`) are stored verbatim in [`FILES.md`](FILES.md).
> Times are relative to when we start (T+0). **Final demo video by ~2:30 PM.**

|       | Person       | Agent                                                      | Owns (folders)                                                                                                                 |
| ----- | ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **Yashasvi** | Codex: Sol 6.2 only (never Astra)                          | Business + cluster: `services/`, `infra/` (`infra/nudgebee/` is recreated verbatim from `FILES.md`, not rewritten), `Makefile` |
| **B** | **Nayan**    | Claude Code: Opus 5.5 (controller), Sonnet 5.5 (dashboard) | Control side: `apps/controller`, `apps/dashboard`. Demo Mac                                                                    |

---

## What already exists (verify, don't rebuild)

| Piece           | State                                                                                                                                                                                                                                                                                  | Where it's described                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Flagsmith       | Project `festive-rush` (55637), env `demo` (119210), flag `home_delivery_enabled`, 6 segments with overrides, identity overrides on `cust-blr/mum/del-0001`, server + admin keys in `.env`                                                                                             | `CONTRACTS.md` §5                                                   |
| NudgeBee VM     | GCP `instance-20261124-125212` (asia-south1-a), NudgeBee 1.14 on k3s                                                                                                                                                                                                                   | `RUNBOOK.md` §0                                                     |
| NudgeBee config | Cluster account `demo-mac` (agent key in `.env`), proxy agent `demo-mac-mcp-proxy` (keys in `.env`), MCP integration `festive-rush-controller` → `http://controller.shop/mcp`, Account Context `festive-rush-recovery`, automation `festive-rush investigate delivery alert` v3 Active | `infra/nudgebee/nubi-config.md`, `automation.json`, `RUNBOOK.md` §2 |
| Sarvam          | Provider `sarvam-rehearsal` → **shim** `http://sarvam-shim.festive-shim.svc/v1`; model catalog row; `LLM_MODEL_MAX_OUTPUT_TOKENS=16384`                                                                                                                                                | `ARCHITECTURE.md` §7.4                                              |
| Scripts         | `infra/nudgebee/tunnels.sh`, `infra/nudgebee/install-agents.sh` (recreated from `FILES.md` in setup)                                                                                                                                                                                   | `RUNBOOK.md` §1                                                     |
| Demo Mac tools  | colima, kind, kubectl, helm, jq, bun, gcloud (`GCLOUD` in `.env`)                                                                                                                                                                                                                      | —                                                                   |

**Names that must not change.** The NudgeBee and Flagsmith setup points at them:

- namespaces `shop`, `providers`, `monitoring`, `nudgebee`; KinD cluster `rehearsal` (context `kind-rehearsal`);
- controller Service `controller` in `shop`, port 80 → container 4100, MCP at `POST /mcp`, tools `list_playbooks` / `submit_findings` with the §3.5 schemas;
- alert name `DeliveryAvailabilityLow`; Alertmanager → `http://nudgebee-agent-runner.nudgebee.svc/api/alerts` and `http://controller.shop/webhooks/alertmanager`;
- metric names and labels in `CONTRACTS.md` §4 (the Account Context names them);
- Flagsmith flag, segment and trait names; customer ID rule; `0001` = probe identity;
- playbook id `city-delivery-fallback`.

---

## Setup (both, first 30 min)

```sh
# New, empty project with only the markdown files: AGENTS.md and docs/*.md
git init && git add -A && git commit -m "Docs for the 25 Nov build"   # then add the new GitHub remote and push
# Ask an agent: "Create every file in docs/FILES.md verbatim, then chmod +x infra/nudgebee/*.sh"; commit.
# AirDrop the real .env into the project root on both Macs (it is git-ignored).
colima start        # demo Mac; backup Mac: its own Docker runtime
kind get clusters   # if 'rehearsal' still exists from 24 Nov: kind delete cluster --name rehearsal
```

- Docker VM ≥ 8 GB RAM, ≥ 4 CPUs. Never use ports 5000/7000.
- `.env` must be complete on both Macs (AirDrop from Nayan): Flagsmith keys, `ADMIN_SECRET`, `NUDGEBEE_*`, `GCLOUD`.
- Quick smoke of the kept setup: NudgeBee VM RUNNING (`$GCLOUD compute instances list`), Flagsmith UI shows the Mumbai fallback override flag **on** and recovery split **0**.

## Timeline

| Time                | Yashasvi (Codex) — business + cluster                                                                                     | Nayan (Claude Code) — control side                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T+0:00              | Setup (above)                                                                                                             | Setup (above)                                                                       |
| T+0:30              | A1 partner-mock, A2 shop-api                                                                                              | B2 controller core (Opus) **and in parallel** B6 dashboard (Sonnet, second session) |
| T+1:30              | A3 load-generator, A4 Dockerfiles + KinD + manifests + Makefile                                                           | B3 incidents/findings/actions/audit                                                 |
| **T+2:30 — sync 1** | `make up` on the demo Mac. Fake alert (`curl`) → findings form → Approve → Mumbai pickup only → Advance 5%. Cross-review. |                                                                                     |
| T+2:30              | A5 monitoring + alert                                                                                                     | B4 MCP, B5 loops/impact/evidence/fault                                              |
| T+3:30              | A6 reconnect NudgeBee (scripts, no UI setup)                                                                              | B6 finish against the real controller                                               |
| **T+4:00 — sync 2** | Full run per `RUNBOOK.md` §4 on the demo Mac, NuBi automatic. Cross-review.                                               |                                                                                     |
| T+4:30              | Backup Mac (A7)                                                                                                           | Fix what broke; `docs/demo-script.md` (B8)                                          |
| **~2:30 PM**        | **Record the final demo video**, then rehearse the pitch twice                                                            |                                                                                     |

If a step runs long, cut scope (below), never sync 2 or the recording.

---

## How each person uses their agent

- **Nayan:** Opus 5.5 for the controller (B2–B5, debugging). Sonnet 5.5 for the dashboard (B6) in a second session. Different folders, so they can run at once.
- **Yashasvi:** Sol 6.2 for every A task. Never Astra. For unknowns, work in small steps and stop at the first failing step.
- **Every session starts with:** _"Read AGENTS.md (Start here + Lessons) and docs/CONTRACTS.md first."_ One task per prompt; run its check; commit; `git pull --rebase` before `git push`.
- If an agent wants a contract change, it stops and tells its human; the humans agree and edit `CONTRACTS.md`.

---

## Prompts

Paste as-is. Each assumes `AGENTS.md` and `docs/CONTRACTS.md` were read, and ends with its check.

### Yashasvi (Codex) — A prompts

**A1 — partner-mock**

> Build `services/partner-mock` (Bun, TypeScript, express, prom-client) per CONTRACTS.md §1, §3.2, §4, §7. `POST /{a|b|c}/shipments` returns 200 normally and 500 `PROVIDER_UNAVAILABLE` while that provider has an outage; `POST /admin/outage` behind `X-Admin-Secret` with body per §3.2; `GET /healthz`; `/metrics` with `partner_requests_total`. In-memory state, no city logic. JSON logs to stdout. Check: shipment on `/b` → 200; outage on b → `/b` 500 and `/a` 200; clear → `/b` 200.

**A2 — shop-api**

> Build `services/shop-api` per CONTRACTS.md §2, §3.1, §3.4 (order event), §4, §5, §7. City and provider come from the ID rule in §2. Evaluate `home_delivery_enabled` with `flagsmith-nodejs` ≥ 8.1.2 in local-evaluation mode, identity = the exact `customerId`, trait `city`, refresh 5 s; if Flagsmith isn't configured, default to on. **Don't special-case customer `0001`**: Flagsmith gives the probe identities an override. Delivery calls `PARTNER_URL/{provider}/shipments` with a 2 s timeout. Emit the four shop-api metrics (no customerId/orderId labels). Send the order event to `CONTROLLER_URL/internal/orders` best effort (500 ms, ignore errors, skip if unset). `/healthz`; JSON logs. One `bun test` file for ID → city/provider and flag → options. Check: Mumbai delivery order → 201; outage on b → Mumbai 502 with `provider:"b"`, Bengaluru 201; `/metrics` shows `courier_dispatch_total{provider="b",status="500"}`; `GET /api/options?customerId=cust-mum-0002` returns `options` exactly per §3.1.

**A3 — load-generator**

> Build `services/load-generator` per CONTRACTS.md §2 and §7: rate-limited (**default `RATE_PER_SEC` 20, `DURATION_SEC` 3600**, `DELIVERY_RATIO` 0.7), uses IDs **0002–0500** per city (never 0001), calls `/api/options` first and only attempts delivery when offered, random `amount` 300–5000, one JSON summary line per city every 10 s. Check: 60 s run; shop-api `/metrics` shows `shop_orders_total` for all three cities.

**A4 — images, KinD, manifests, Makefile**

> Dockerfiles (`oven/bun:1-slim`, arm64) for the three services. `infra/kind/cluster.yaml` (cluster name `rehearsal`) with the `extraPortMappings` in CONTRACTS.md §1 (incl. Grafana 30301 → 3001). `infra/k8s/` per CONTRACTS.md §6: namespaces `shop`, `providers`, `monitoring`; Deployments + Services (NodePorts) for partner-mock, shop-api, load-generator (**replicas 0**; env `RATE_PER_SEC=20`, `DURATION_SEC=3600`), **controller** (port 4100, Service `controller` port 80, `emptyDir` at `/data`, env per §7, readiness `/healthz`) and **dashboard** (port 3000, readiness `/healthz`); `infra/k8s/secrets.sh` that builds `app-secrets` from `.env`. Makefile: `up` (create cluster if missing, `images`, `deploy`), `down`, `images` (builds the three services **and** `apps/controller`, `apps/dashboard`, then `kind load`), `deploy`, `load-start`/`load-stop` (scale), `outage P=` / `outage-clear P=` (`kubectl exec` into partner-mock with `bun -e` + `fetch`), `redherring` (rollout restart shop-api), `monitoring` (see A5; it must load `.env` itself). Images `:dev`, `imagePullPolicy: IfNotPresent`. Check: `make up` on a clean Mac → all pods Ready (controller/dashboard come from Nayan's folders; if they aren't pushed yet, deploy the rest and say so); `make outage P=b` → Mumbai delivery fails; `make outage-clear P=b` → back.

**A5 — monitoring + alert**

> kube-prometheus-stack in `monitoring`, laptop-sized values in `infra/monitoring/values.yaml`: default rules, kube-state-metrics and node-exporter off; Grafana NodePort 30301; `evaluationInterval: 10s`; `serviceMonitorSelector`/`ruleSelector` on `release: kube-prometheus-stack`. ServiceMonitors for shop-api and partner-mock (10 s). PrometheusRule `DeliveryAvailabilityLow` exactly per CONTRACTS.md §4 (`for: 1m`). Alertmanager: `group_wait: 5s`, `group_interval: 10s`, `repeat_interval: 4h`; child routes with `continue: true` to NudgeBee (`url_file` from Secret `monitoring/nudgebee-webhook`, value `NUDGEBEE_WEBHOOK_URL` from `.env`) and to `http://controller.shop/webhooks/alertmanager`, both `send_resolved: true`. `make monitoring` loads `.env`, creates the secret and installs everything. Check: with load running, `make outage P=b` → alert firing in ~90 s and the controller opens an incident; Alertmanager shows no failures for the controller receiver.

**A6 — reconnect NudgeBee (no UI setup)**

> NudgeBee is already configured (see WORK.md "What already exists"). Only reconnect this cluster: in a separate terminal run `sh infra/nudgebee/tunnels.sh` (keep it running), then `sh infra/nudgebee/install-agents.sh`. Verify in the NudgeBee UI (`localhost:18080`): Kubernetes account `demo-mac` Active; Proxy Agent `demo-mac-mcp-proxy` connected; MCP `festive-rush-controller` → Test Connection passes; automation v3 Active. Don't edit the MCP text, Account Context, automation or LLM provider. Never write NuBi output. Check: RUNBOOK §3 reset, then `make outage P=b` → within ~6 min the incident page shows findings with source `nubi` and no human input in NudgeBee.

**A7 — backup Mac**

> On Yashasvi's Mac, follow RUNBOOK §0–§3. NudgeBee: this cluster needs its own NudgeBee cluster account (reuse `kind-rehearsal` + `rehearsal-mcp-proxy` from the preflight if possible) and, for that account, the MCP integration, Account Context and automation from `infra/nudgebee/nubi-config.md` and `automation.json` (change `account_id`). Don't touch `demo-mac`. Check: an outage on this Mac produces NuBi findings on this Mac's dashboard.

### Nayan (Claude Code) — B prompts

**B1 — nothing to do.** Flagsmith is set up and verified (`CONTRACTS.md` §5). Don't edit segments or overrides by hand.

**B2 — controller core (Opus)**

> Create `apps/controller` (Bun, TypeScript, no build step; deps only `yaml`, `flagsmith-nodejs`, `@modelcontextprotocol/sdk`; SQLite via `bun:sqlite`). (1) Flagsmith Admin API client using ONLY the calls in CONTRACTS.md §5 (Api-Key auth, v2 versioning, exact-name filtering). Cache feature/segment IDs per value; every action is **one write + one read-back** (no read before write). The fallback override always exists: set it to the playbook's `flag.fallback`/`flag.normal` state; never create or delete overrides. (2) Playbook schema + validation per §8, stored in SQLite (`DB_PATH`), seeded from `PLAYBOOK_DIR/*.yaml` when empty; `{value}` / `{probe_identity}` / `${ENV}` templating. Seed `playbooks/city-delivery-fallback.yaml` = ARCHITECTURE.md §9.3 **with the demo values there** (min_samples 10, window 20s, cooldown 60s, probe every 10s, healthy_for 60s). No city/flag/segment/field names in code or tests. (3) `GET /healthz`; a `log()` helper writing one JSON line to stdout; `Dockerfile` (`oven/bun:1-slim`, copy `src/` + `playbooks/`, `/data` writable, `USER bun`, port 4100) + `.dockerignore`. `bun test` for validation and templating; **tests read values from the seed, never hard-code them**. Check: `scripts/check-flagsmith.ts <playbook> <value>` applies the fallback, sets split 5, reads back, resets; local-eval over 200 identities per city shows other cities untouched and ~5% of the value's customers on delivery; Flagsmith left normal.

**B3 — incidents, findings, actions, audit (Opus)**

> In `apps/controller`: SQLite tables for incidents, findings, order events, audit. `POST /internal/orders`; `POST /webhooks/alertmanager` (open or dedupe into the open incident; resolved notices logged); all incident endpoints and read shapes in CONTRACTS.md §3.4 (incl. "Other read shapes", audit flag-state keys, `{"actor"}` on approve/advance/rollback/close); `POST /api/incidents/:id/findings` with the §3.5 validation. Ticket lifecycle §9.4 + state machine §9.1: no recommendation/Approve before valid findings; status stays **Investigating** until Approve; Approve applies the fallback; Advance operator-only, 409 `GUARDRAIL_NOT_PASSED` until min sample + window + error rate pass; Rollback → split 0. Every action: audit row with before/after/readBack. Probe orders (playbook `probe.identities`) are excluded from availability, guardrail and impact; `synthetic` filters nothing. JSON log line for every request (except `/healthz`), transition and Flagsmith write. `bun test` for state machine, findings validation, guardrail. Check: with shop-api running (or contract-shaped events via curl), walk fake alert → findings form → approve → advance 5% → rollback with curl; audit shows each step; Flagsmith left normal.

**B4 — MCP (Opus)**

> In `apps/controller`, `POST /mcp` with `list_playbooks` and `submit_findings` exactly per CONTRACTS.md §3.5: SDK `WebStandardStreamableHTTPServerTransport`, stateless (new server per request), JSON responses, low-level `Server` with plain JSON Schemas (no zod). Same validation/storage as the findings form, `source: "nubi"`, `summary` stored byte-for-byte; rejections return `{"accepted":false,"error","message"}` with `isError: true`. Attach to the newest Investigating incident whose alert is in the playbook's `match.alerts`. Log tool name + accepted/rejected (never the summary). Check: SDK client script: tools/list shows both; `pune` → `VALUE_NOT_ALLOWED`; valid call after a fake alert attaches to it and the stored summary matches byte-for-byte.

**B5 — loops, impact, evidence, fault (Opus)**

> In `apps/controller`: (1) Guardrail loop every 5 s, one health function (order events via the playbook's `events` fields; PromQL only when `PROMETHEUS_URL` is set). **Automatic rollback** on ≥ `max_consecutive_errors`, or error rate > max over the window or the whole step (rates only once `min_samples`); ticket back to Mitigated; actor `controller`. Never advances. An Alertmanager **re-fire during a canary step** takes the same rollback path (actor `alertmanager`). (2) `cooldown_after_rollback`: Advance → 409 `COOLDOWN_ACTIVE`. (3) Probe loop per the playbook `probe` block, only while Mitigated; probes count from the latest approve/rollback; FALLBACK → PROBE_OK after `healthy_for`, back on failure. **Known 24 Nov bug to avoid:** after an automatic rollback, PROBE_OK came ~7 min later than `healthy_for` allowed. Write a fake-time `bun test` for rollback → healthy probes → PROBE_OK within `healthy_for` + one interval. (4) `impact` (§3.4; this value only, probes excluded), `GET /api/incidents/:id/evidence` (JSON, `?format=csv`), `POST /api/fault` → partner-mock per §3.2, `POST /api/playbooks/:id/check`. Check on the cluster: during CANARY_10, `make outage P=b` → automatic rollback < 15 s with audit row and read-back split 0; Advance refused during cooldown; `make outage-clear P=b` → PROBE_OK within ~70 s.

**B6 — dashboard (Sonnet, parallel from T+0:30)**

> **First invoke the taste skill (`design-taste-frontend`) and follow it for all UI work (its ops-dashboard rules and its look-and-fix loop on screenshots).** Create `apps/dashboard` (Next.js under Bun: `bun --bun next dev|build|start -p 3000`; deps next/react + typescript/@types as dev deps; plain CSS; `next.config.ts` with `agentRules: false`, reading only its own vars from `../../.env` when present). Pages per ARCHITECTURE.md §5.5 using **exactly** the shapes in CONTRACTS.md §3.4: overview (availability fraction as %, open incidents, playbook ready/broken, incident list); `/incidents/[id]` (status steps, NuBi summary verbatim + link, findings form, recommendation + Approve, recovery panel only after Approve with Advance enabled only when `advanceAllowed` and a reason when not, Rollback, impact, probe, timeline, evidence download, Close with required note); playbooks with readiness and reasons; storefront (fixed demo IDs, never `0001`); demo controls (`DEMO_PROVIDERS`); audit (flag state as before → after + read back). Poll every 2 s. Show "advance: operator · rollback: automatic". Ops calls go through Next.js server routes that add `X-Admin-Secret` (never in the browser), proxy timeout 60 s, buttons disabled with "working…" while a call runs, operator name from the nav sent as `actor`. `GET /healthz`; `Dockerfile` + `.dockerignore`. Check: `bun run build` passes; `ADMIN_SECRET` value not in `.next/static`; against the real controller, the whole flow clicks through without a terminal.

**B7 — stretch:** `POST`/`PUT /api/playbooks` (CONTRACTS.md §3.4, same validation, bumps version) and the playbook wizard (§9.5). Only if sync 2 is green.

**B8 — demo script:** write `docs/demo-script.md`, a 5–7 min stage script for `RUNBOOK.md` §4: what to click, what the audience sees, what to say; fill the ~4-min NuBi gap (NudgeBee investigation view, Grafana, the playbook); the rollback moment; fallback lines; honesty rules (`ARCHITECTURE.md` §15).

---

## Staying unblocked

- **Nayan doesn't wait for the cluster:** run services with `bun run dev` locally until `make up` works; health comes from order events.
- **Nayan doesn't wait for NudgeBee:** the findings form uses the same validation as MCP.
- **Yashasvi doesn't wait for the controller:** test with curl; for the alert, a temporary request-logging pod.
- **Integrate through git.** Stuck for 30 minutes? Say so at once.

## Cutting scope

Sync 1 is the gate. Cut from the bottom, never the top:

1. Flagsmith fallback + guarded recovery, with findings via the form
2. Incident tickets and audit
3. NuBi investigation + `submit_findings` over MCP (already configured; only A6 + B4 needed)
4. Automatic rollback
5. Provider probe
6. Business impact + evidence pack
7. Playbook readiness checks
8. Playbook write API + wizard (B7)
9. Sarvam win-back messages, readiness drills (pitch only)

If item 3 fails on stage, use the form with `source: operator` and say so. Never fake NuBi output.

## Demo Mac checklist

Full steps: [`RUNBOOK.md`](RUNBOOK.md).

- [ ] Charger, `caffeinate -dims`, Focus mode; hotspot connected
- [ ] `colima start`; NudgeBee VM RUNNING; `sh infra/nudgebee/tunnels.sh` running in its own terminal
- [ ] NudgeBee: `demo-mac` Active, MCP `festive-rush-controller` Enabled, automation v3 **Active**, LLM endpoint = Sarvam shim
- [ ] RUNBOOK §3 reset done: outages cleared, fresh controller DB, Mumbai fallback not active (override flag = on) and split 0, shop-api at 1, load running (20 orders/s)
- [ ] Don't restart the controller during the demo (it wipes incidents)
- [ ] Grafana, NudgeBee and dashboard tabs open; backup Mac on the same commit with `.env`
- [ ] Nothing in the pitch calls a human click "automatic" or hand-written text "NuBi output"
