# Demo runbook (event day, 25 Nov)

Agents: read `AGENTS.md` (Start here + Lessons) first; build tasks are in `WORK.md` → Prompts.

**25 Nov:** the code is rebuilt from scratch in a new project with the same names, paths, ports and Makefile targets. `infra/nudgebee/*` (scripts, shim manifest, NuBi config, automation) is created verbatim from [`FILES.md`](FILES.md) at setup, so every command here still applies once A1–A6 and B2–B6 are done. Sections 0–2 cover the setup that is *kept* (NudgeBee, Sarvam, Flagsmith); the timings in §4 are from the 24 Nov build and are the target for the rebuild (the recovery rows are from the 25 Nov cluster run).

What to run, in order, on the **demo Mac (Nayan's)**. Every step here was done for real on 24 Nov evening; the full chain worked with no human input: outage on b → alert (~90 s) → NudgeBee automation → NuBi investigates → `submit_findings` over MCP (~4 min later) → incident page shows NuBi's findings + Approve.

## 0. Before anything

| Check | Command / place | Why it bit us on 24 Nov |
|---|---|---|
| Docker runtime is up | `colima start` (it does **not** start on its own after a reboot) | No Docker = `make` fails |
| Cluster | `kind get clusters` → `rehearsal` | `make up` creates it if missing (on 25 Nov it is recreated from scratch) |
| NudgeBee VM is running | `$GCLOUD compute instances list` → `instance-20261124-125212` RUNNING | NudgeBee server, Sarvam shim and LLM config live there |
| `.env` is complete | has `FLAGSMITH_*`, `ADMIN_SECRET`, `NUDGEBEE_*`, `GCLOUD` | Agent keys are only in `.env` (git-ignored) |
| Preflight | `bun run preflight` in `apps/controller` | Read-only check of the clean state and NudgeBee reachability |

## 1. Bring the stack up

```sh
colima start
make up                                    # images + KinD + all five apps
set -a; . ./.env; set +a; make monitoring  # kube-prometheus-stack + alert + routes (needs NUDGEBEE_WEBHOOK_URL in the shell)
sh infra/nudgebee/tunnels.sh               # own terminal; leave it running all demo (auto-reconnects)
sh infra/nudgebee/install-agents.sh        # NudgeBee agent + MCP proxy agent on kind-rehearsal (idempotent)
```

Checks:
- `curl localhost:4100/healthz`, `localhost:3000/healthz`, `localhost:4001/healthz` → `{"ok":true}`
- `curl -s -o /dev/null -w '%{http_code}' localhost:18080/` → 200 (NudgeBee UI through the tunnel)
- NudgeBee UI → Admin → Integrations → Kubernetes: `demo-mac` **Active**; MCP: `festive-rush-controller` **Enabled**; Proxy Agent: `demo-mac-mcp-proxy` **Enabled**

## 2. NudgeBee configuration (already done; verify, don't redo)

All in the NudgeBee UI at `localhost:18080` (admin login from Yashasvi):

| Piece | Where | Value |
|---|---|---|
| Cluster account | Admin → Integrations → Kubernetes | `demo-mac` (Yashasvi's `kind-rehearsal` account is separate; don't reuse its token) |
| MCP server | Admin → Integrations → MCP | `festive-rush-controller`, account `demo-mac`, mode **Proxy Agent**, URL `http://controller.shop/mcp`, instructions in `infra/nudgebee/nubi-config.md` |
| Proxy agent | Admin → Integrations → Proxy Agent | `demo-mac-mcp-proxy` (forager in namespace `nudgebee`) |
| Account context | Admin → AI & Tools → Account Context → account `demo-mac` | `festive-rush-recovery`, text in `infra/nudgebee/nubi-config.md` |
| Automation | Automations → `festive-rush investigate delivery alert` | Event trigger `event_type == "DeliveryAvailabilityLow"` → Event Investigate → **Nubi** step; live version **v3, Active**, timeout 20 m. Definition: `infra/nudgebee/automation.json` |
| LLM provider | Admin → Integrations → LLM | `sarvam-rehearsal`, endpoint **`http://sarvam-shim.festive-shim.svc/v1`** (not api.sarvam.ai) |
| Model catalog | Admin → AI & Tools → Budgets & Limits → Model Pricing | `custom / sarvam-105b`, max output 16,384 |

**Sarvam fix (don't undo):** NudgeBee's custom provider sends `max_completion_tokens`; Sarvam ignores it and defaults to 2,048 output tokens, which the reasoning model spends on thinking → empty replies → "investigation failed". The shim (`infra/nudgebee/sarvam-shim.yaml`, namespace `festive-shim` on the VM) rewrites it to `max_tokens: 16384`. Also set: env `LLM_MODEL_MAX_OUTPUT_TOKENS=16384` on `llm-server` (a NudgeBee Helm upgrade resets it — then re-run `kubectl -n nudgebee set env deploy/llm-server LLM_MODEL_MAX_OUTPUT_TOKENS=16384` on the VM). Symptom if broken: NudgeBee `llm-server` logs `"LLM returned empty content"` with `"stopReason":"length"`.

**Why a Nubi step and not only Event Investigate:** NudgeBee groups repeat alerts as *Duplicate* of the first event and Event Investigate returns that cached analysis (no MCP call). The Nubi step starts a fresh conversation every run. Old events can't be set to Resolved in the UI ("Failed to update status"), so don't rely on that.

## 3. Reset to a clean demo state (do this before each run)

```sh
make outage-clear P=a; make outage-clear P=b; make outage-clear P=c
kubectl --context kind-rehearsal -n shop delete pod -l app=controller   # fresh controller DB (emptyDir) → no old incidents
kubectl --context kind-rehearsal -n shop scale deploy/shop-api --replicas=1
make load-start
```
- Log in to the dashboard (`localhost:3000`) as `admin` / `admin` (or sign up). Every page and `/api/c` need a session, and every click is logged under the logged-in name. Users live in the dashboard's memory: after a dashboard restart or `rollout restart` the sign-ups are gone and only `admin` is re-seeded, so log in again.
- If NuBi stays silent after the alert: the NudgeBee SSH tunnel may have dropped, and the agent then drops the alert event silently. Check `kubectl --context kind-rehearsal -n nudgebee logs deploy/nudgebee-forager-nudgebee-forager-chart --since=3m | grep refused`, restart `tunnels.sh`, and re-send the alert by deleting the alertmanager pod.
- Flagsmith must be normal: Mumbai fallback override **on** (= delivery on), split 0. Check the dashboard Overview, or run `bun --env-file=../../.env scripts/check-flagsmith.ts city-delivery-fallback mumbai` in `apps/controller` (B2's check script; it resets at the end).
- Don't hand-edit Flagsmith segments while the controller runs. Don't touch the three probe identity overrides (`cust-*-0001`).

## 4. The run and its real timings (24 Nov)

Full rehearsal on 24 Nov (18:11–18:56 UTC): approve → probe → 5/10/50% → outage → automatic rollback in 8 s → cooldown refused Advance → 5/10/50/100% → Resolved → Closed; Flagsmith ended normal. On 25 Nov the playbook got `recovery.auto_advance: true`: the operator clicks **Start recovery at 5%** once and the controller advances the rest. If a playbook lacks the flag, Advance is a click per step again. Demo values since then: load 20 orders/s (`infra/k8s/load-generator.yaml`), `min_samples` 10, `window` 20s, `healthy_for` 60s, probe every 10s, cooldown 60s (seed playbook; a fresh controller DB re-seeds them).


| Step | Who | Time from outage |
|---|---|---|
| `make redherring` (optional, before the outage) | operator | — |
| `make outage P=b` (or Demo controls → b outage) | operator | 0 |
| Alert fires; incident **Investigating** on the dashboard | automatic | ~90 s |
| NuBi findings appear on the incident page (verbatim) | automatic (NudgeBee automation) | ~5–6 min |
| Approve → **Mitigated** (Mumbai shows pickup only) | operator | — |
| Clear the outage; probe healthy for `healthy_for` (60 s) → PROBE_OK | automatic | +1 m |
| **Start recovery at 5%** (the one recovery click) | operator | PROBE_OK ~60–70 s after clearing the outage |
| 5% → 10% → 50% → 100% → Resolved (fallback off); no Advance clicks, each step needs 10 canary orders + 20 s window | automatic (`recovery.auto_advance`, audit "automatic advance: guardrail passed") | ~130–170 s for the whole ladder (25 Nov: 166 s, 133 s; the 5% step is the slowest, ~70–80 s) |
| Optional: outage again during a canary step → **automatic rollback**, then 60 s cooldown | automatic | 2 s (measured at 50%, 25 Nov; 8 s on 24 Nov) |
| Close with a note | operator | — |

The incident stays **Investigating** after NuBi's findings arrive: that's by design (ARCHITECTURE §9.4). It moves to Mitigated only when a human clicks Approve.

NuBi takes ~4 min to investigate. Fill that time in the pitch (explain the playbook, show NudgeBee working live in its Troubleshoot view, or show Grafana on `localhost:3001`).

## 5. If something breaks on stage

| Symptom | Fix |
|---|---|
| No NuBi findings after ~8 min | Use the incident page's **findings form** (`source: operator`) and say so. Never type NuBi text yourself |
| NudgeBee UI / agent disconnected | Is `tunnels.sh` still running? Is the VM up? |
| Dashboard shows "Controller unreachable" | `kubectl -n shop get pods`; `colima status` |
| Approve slow | Flagsmith latency; it shows "working…", wait ≤ 10 s |
| Alert never fires | `make load-start` running? shop-api scaled to 1? |
| Overview shows no incidents (old ones gone) | The controller restarted; its DB is `emptyDir`. Expected after a reset; never restart it mid-demo |
| Dashboard redirects to `/login` or API calls return 401 | Session expired (12 h) or the dashboard restarted: log in again (`admin` / `admin`) |
| After rebuilding images the old behaviour is still there | `make up` reuses the cluster and does not restart unchanged deployments: `kubectl --context kind-rehearsal -n providers rollout restart deploy/partner-mock`, and `-n shop rollout restart deploy/dashboard` |
| Probe healthy but Advance stays locked well past `healthy_for` | Seen once on 24 Nov after a rollback; the B5 prompt asks for a test that prevents it. Wait, or say so; don't restart the controller |
| NuBi investigation fails / empty replies | VM `llm-server` logs show `stopReason":"length"` → Sarvam shim bypassed; check LLM endpoint = `http://sarvam-shim.festive-shim.svc/v1` |
| NuBi investigates but no findings | Automation v3 Active? Account Context `festive-rush-recovery` present on `demo-mac`? |

## 6. After the demo / overnight

Save the Flagsmith quota (free plan 50k calls/month; one shop-api polls every 5 s):
```sh
make outage-clear P=b; make load-stop
kubectl --context kind-rehearsal -n shop scale deploy/shop-api --replicas=0
```
Stop `tunnels.sh` (Ctrl-C). `colima stop` if not needed.
