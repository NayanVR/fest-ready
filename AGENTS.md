# Agent instructions

Read by Codex directly and by Claude Code through `CLAUDE.md`. Humans: Nayan (Claude Code) and Yashasvi (Codex).

## The project

A festive-rush resilience demo. When one city's courier provider goes down:

- NuBi investigates and submits findings to the controller over MCP.
- The operator approves a playbook that moves only that city's customers to pickup via Flagsmith.
- Delivery comes back in operator-approved steps, with automatic rollback.

Design: `docs/ARCHITECTURE.md`. Interfaces: `docs/CONTRACTS.md`. Plan: `docs/WORK.md`.

## Start here (25 Nov, event day: rebuild from scratch)

- **Kept as is, don't recreate or reconfigure:** Flagsmith (project, flag, segments, identity overrides, keys), the NudgeBee VM and everything configured in it (cluster account `demo-mac`, proxy agent, MCP integration, Account Context, automation, Sarvam provider + shim), `.env` (AirDrop, git-ignored). The non-markdown files we still need (`CLAUDE.md`, `.gitignore`, `.env.example`, `infra/nudgebee/*`) are stored verbatim in `docs/FILES.md`: create them from there in the first setup step; never rewrite them. See `docs/WORK.md` → "What already exists" and "Names that must not change".
- **Your task and its exact prompt:** `docs/WORK.md` → Timeline and Prompts (A1–A7 Yashasvi/Codex, B2–B8 Nayan/Claude Code). The prompts already include everything we learned on 24 Nov. Take one prompt per session.
- **How to run, reset and rescue the demo:** `docs/RUNBOOK.md`. **Verified vs simulated vs proposed:** `docs/ARCHITECTURE.md` §15.
- **Layout to build:** controller `apps/controller`, dashboard `apps/dashboard`, services `services/{partner-mock,shop-api,load-generator}`, `infra/kind`, `infra/k8s`, `infra/monitoring`, `Makefile`. Runtime: KinD cluster `rehearsal` (context `kind-rehearsal`) on colima; from the Mac: dashboard `:3000`, shop-api `:4001`, controller `:4100`, Grafana `:3001`, NudgeBee UI `:18080` (via `infra/nudgebee/tunnels.sh`).

**Before writing any code, read `docs/CONTRACTS.md`.** It is the source of truth for ports, endpoints, payloads, metric names, env vars and Kubernetes objects. Codex: also read "What already exists" and "Names that must not change" at the top of `docs/WORK.md`.

## Who edits what

| Folder                                            | Owner       | Agent       |
| ------------------------------------------------- | ----------- | ----------- |
| `services/`, `infra/`, `Makefile`                 | Yashasvi    | Codex       |
| `apps/controller/`, `apps/dashboard/`             | Nayan       | Claude Code |
| `docs/`, `AGENTS.md`, `CLAUDE.md`, `.env.example` | humans only | —           |

Edit only your human's folders. If the other side doesn't match the contract, stop and tell your human; don't patch the other side and don't change `docs/CONTRACTS.md`. Exception: when your human explicitly hands you the other side's task (as on 24 Nov, when Yashasvi was out of quota), do it, start the commit message with `infra:`/`services:` and "done for <name>", and list every file you changed in your report.

## Stack

- Bun 1.x (runtime, package manager and test runner), TypeScript run directly by Bun with no build step, ESM. Each service has its own `package.json` with `bun run dev`, `bun start`, `bun test`; install with `bun install` (commit `bun.lock`). No monorepo tooling. The dashboard runs Next.js under Bun (`bun --bun next ...`).
- Allowed dependencies: `express`, `prom-client`, `flagsmith-nodejs`, `yaml`, `@modelcontextprotocol/sdk` (controller), SQLite via built-in `bun:sqlite` (controller, no library), `next`/`react` (dashboard). Ask before adding anything else.
- Tests: `bun test` (built-in), only for non-trivial logic (ID → city/provider, flag → options, playbook validation and templating, findings validation, state machine, guardrail). No test frameworks.

## Hard rules

- The controller never contains a city, provider, flag or segment name, or an order-event field name; everything comes from the playbook. Playbooks live in the controller's SQLite database (seeded from `apps/controller/playbooks/*.yaml`).
- The controller does not diagnose. No recommendation and no Approve until valid findings arrive (MCP `submit_findings`, or the operator form marked `source: "operator"`).
- Never guess Flagsmith Admin API paths. Use `docs/CONTRACTS.md` §5; if a call is marked [VERIFY], stop and ask.
- Never write, paraphrase or simulate NudgeBee/NuBi output. Store and show NuBi's `summary` verbatim.
- The controller never advances a recovery step on its own. Advance is operator-only; rollback is automatic.
- No service contains failure logic for a specific city. Faults come only from partner-mock's outage switch.
- Never put `customerId` or `orderId` in a metric label.
- Secrets come from env vars only. Never commit `.env`. `FLAGSMITH_MGMT_TOKEN` is used only in the controller; `ADMIN_SECRET` never reaches the browser.
- macOS: never use ports 5000 or 7000. Images use the `:dev` tag with `imagePullPolicy: IfNotPresent`.

## Lessons from 24 Nov (rules)

- **Check exact fields, never grep whole JSON.** `grep delivery` matched `home_delivery_enabled` in every response and produced a false "200/200" alarm. Use `jq` on the field you mean (e.g. `.options | index("delivery")`).
- **Leave shared state as you found it.** After any test: Flagsmith normal (Mumbai fallback override on, split 0), outages cleared, `make load-stop`, shop-api scaled to 0 (the free Flagsmith plan has 50k calls/month and shop-api polls every 5 s). Say in your report what you left running.
- **The controller DB is `emptyDir`.** Restarting or redeploying the controller deletes all incidents (the Overview goes empty). Only do it as a deliberate reset, and say so.
- **Playbook timings come from the seed YAML** (`apps/controller/playbooks/`) unless the optional `PUT /api/playbooks` (B7) gets built. After changing the seed: rebuild the image (`docker build -t controller:dev apps/controller && kind load docker-image --name rehearsal controller:dev`) and restart the controller (which resets the DB).
- **Tests read demo values from the seed playbook**; never hard-code windows, sample sizes or durations (a hard-coded 60 s broke when the demo values changed).
- **Don't change the NudgeBee/Sarvam setup without updating `docs/RUNBOOK.md`, `infra/nudgebee/` and `docs/FILES.md`.** The Sarvam shim, the model catalog row, the `LLM_MODEL_MAX_OUTPUT_TOKENS` env, the account context and the automation are all required; removing any one silently breaks NuBi.
- **Never write NuBi's conclusion for it.** Instructions may say which tools to use and where data lives; they must not name the city, provider or cause.
- **Don't scale or restart shop-api/load-generator right before an outage test**: NuBi correctly treats recent deploy changes as candidate causes.
- **Wait by polling** (`until <check>; do sleep 3; done` with a deadline of a few minutes), not long blind sleeps; report progress between polls.
- **Long-running helpers (tunnels, port-forwards) belong in the human's terminal**, not in an agent session (agent background tasks stop after 2 h).
- **Secrets:** keys go in `.env` only (git-ignored); check `git diff --cached` for key material before committing.

## Working style

- Codex: use Sol 6.2 only. Never use Astra (it drains our usage limits too quickly).
- **Frontend work (dashboard, storefront, any UI): use the taste skill** (`design-taste-frontend`; in Claude Code invoke it before writing UI code, then run its look-and-fix loop on screenshots). Applies to B6 and any UI fix.
- One task per prompt. Finish with the check named in the prompt and report its real output.
- Small commits after each passing check; `git pull --rebase` before `git push`.
- Smallest thing that works. No abstractions for one use, no scaffolding for later.
