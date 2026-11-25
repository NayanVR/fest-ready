# FestReady demo script (B8)

Stage script for `RUNBOOK.md` §4. Button and panel names are the real dashboard labels. Spoken lines are in quotes: say them short, in your own words.

Timings come from the 24 Nov rehearsal and the 25 Nov cluster run (`RUNBOOK.md` §4). Re-time everything after the 25 Nov rebuild and edit this file where the numbers differ. Where a label could differ from the build (Grafana panel names, NudgeBee menu names), the script says "check at rehearsal".

## Pick a mode

The real run is longer than a 5–7 min slot, because NuBi alone takes ~5–6 min after the outage.

| Mode | Slot | How |
|---|---|---|
| **Short** | ~6 min on stage | Click **Start outage** ~4½ min before you go on stage (during the pitch intro). The NuBi gap is then mostly gone. Run beats 3b–10. Skip the live rollback (beat 8) and say so. |
| **Full** | ~14 min | Click the outage when the demo starts. Run every beat, including the live rollback. |

## Timeline (T = the Start outage click)

| T | Beat | You click | Audience sees |
|---|---|---|---|
| −2:00 | 0 Pre-flight | reset (RUNBOOK §3), log in as `admin`, open tabs | clean Overview, no incidents |
| 0:00 | 1 Outage | Demo controls → Provider b → **Start outage** | pill "outage on" |
| ~1:30 | 2 Alert | Overview → incident ID | incident **Investigating**, no recommendation |
| 1:30–5:30 | 3 NuBi gap | NudgeBee, Playbooks, Grafana | NuBi working; the playbook; the evidence |
| ~5:30 | 4 Findings | read the Findings card | NuBi's summary, playbook, **Approve** |
| ~6:00 | 5 Approve | **Approve** | **Mitigated**; Mumbai pickup only |
| ~7:00 | 6 Provider fixed | Demo controls → **Clear outage** | probe dots go green; "ok … of 60s needed" |
| ~8:15 | 7 Canary | **Start recovery at 5%** (one click) | split % climbs 5 → 10 → 50 → 100 by itself (~2½ min); samples, guardrail |
| ~9:30 | 8 Rollback (Full only) | **Start outage** during 50% | guardrail breach → 0%, **Mitigated**, cooldown |
| ~11:00 | 9 Resolve | none (automatic) | **Resolved**; 100% on delivery, fallback off |
| ~11:30 | 10 Close | closing note → **Close incident** | **Closed**; impact numbers |

Short mode skips beat 8: it ends about 11:30 after T, so the on-stage part runs from ~4:30 to ~11:30, about 7 min. Re-time at rehearsal; the automatic ladder is ~130–170 s (25 Nov rehearsal 2: outage → NuBi findings +5:11, Approve +5:20, ladder 133 s, closed +12:18).

---

## Beat 0 · Pre-flight (before the audience is watching)

- Reset per `RUNBOOK.md` §3: outages cleared, fresh controller DB, `make load-start`. Flagsmith is normal (Mumbai fallback on, split 0).
- `sh infra/nudgebee/tunnels.sh` is running in its own terminal.
- Tabs, in this order: **Overview** (`:3000`), **Demo controls**, **Storefront**, **Playbooks**, NudgeBee Troubleshoot (`localhost:18080`), Grafana (`localhost:3001`).
- Log in at `:3000` as `admin` / `admin` (or sign up with your own name). Every click is logged under the logged-in name, which backs up the honesty rules below. A dashboard restart wipes sign-ups; log in again.
- Mascot (top of the incident page) shows the state: alert while Investigating, calm when Mitigated, working while Recovering, happy when Resolved. Point at it once.
- Optional red herring: `make redherring` about a minute before the outage. Never closer, and never scale shop-api yourself.

## Beat 1 · The outage

**Click:** Storefront → customer `cust-mum-0142` → shows `delivery`, `pickup`. Then **Demo controls** → Provider b → **Start outage**.

**Audience sees:** Mumbai offered both options; then pill "outage on".

**Say:**
- "A home-decor store. Three cities, three courier providers. Mumbai uses provider b."
- "I'm making provider b fail now. It's simulated: our partner-mock returns 500s. Orders are synthetic load."

## Beat 2 · The alert

**Click:** Overview. When the sub-line says "Needs you: INC-… · Investigating", click the incident ID.

**Audience sees:** Delivery availability drops. Incident page: status **Investigating**. Findings card reads "Waiting for NuBi's findings. The controller doesn't diagnose, so there is no recommendation yet." There is no Approve button. Business impact: "Counted once findings name the value."

**Say:**
- "Every pod is healthy, so Kubernetes sees nothing wrong. Only one city's business flow is broken."
- "The controller knows overall availability and nothing else. No city, no provider, no recommendation. That's deliberate."
- "Diagnosis is NuBi's job. NuBi is investigating right now."

## Beat 3 · Fill the NuBi gap (~4 min)

Do these in order. If findings land early, jump to beat 4.

**3a · NudgeBee Troubleshoot (~1 min).** Open the NudgeBee tab (`localhost:18080`), Troubleshoot view, the running `DeliveryAvailabilityLow` investigation.
- "This is NudgeBee's NuBi, running on Sarvam's model. It was triggered by the alert, not by me."
- Read aloud only what is on screen: the tools it is calling, the queries it runs. Don't predict its conclusion.
- "I don't know what it will say. I'll show you its words, not mine."

**3b · The playbook (~1½ min).** Playbooks tab → card `city-delivery-fallback`.
- Point at: Alerts, `Flag home_delivery_enabled · fallback enabled=false`, `Recovery split · 5% → 10% → 50% → 100%`.
- "A playbook is the contract between the AI and production. NuBi can only pick from fallbacks the business approved in advance."
- "It can't touch Flagsmith. The controller validates the proposal, and a human approves."
- Optional: **Run readiness check**. Playbook badge reads Ready.

**3c · The rule (~30 s).** Say it; the same words appear on the Recovery card after Approve.
- "Start: operator. Steps and rollback: automatic. A human starts the way back. After that the controller moves each step when the numbers pass, and moving customers away from danger never waits for a human."

**3d · Grafana (~1 min).** Grafana tab, the delivery and courier panels (check panel names at rehearsal).
- "This is the data NuBi reads: dispatches by provider and status. Provider b is the one returning 500s."
- "Orders carry a city and a provider label. Never a customer ID."

**Back to the incident page** about 20 s before you expect findings.

## Beat 4 · Findings arrive

**Click:** none. Watch the Findings card (poll is 2 s).

**Audience sees:** a source pill, cause, `Playbook city-delivery-fallback · city mumbai`, NuBi's summary, evidence bullets, link **Open the NuBi investigation ↗**. A **Recommendation** card appears with **Approve**. Business impact now shows orders failed and ₹.

**Say:**
- "That text is NuBi's own, shown verbatim. We store it and don't edit it."
- Read one or two lines of the summary aloud. Click **Open the NuBi investigation ↗** to show it's the same investigation.
- "The controller checked that the playbook exists, the value is allowed, and the cause matches. Only then does Approve appear."
- "Notice the ticket is still Investigating. NuBi doesn't move it. A human does."

## Beat 5 · Approve

**Click:** **Approve** (can take up to ~30 s while Flagsmith confirms). Then Storefront.

**Audience sees:** status **Mitigated**. Storefront: `cust-mum-0142` shows `pickup` only; `cust-blr-0042` and `cust-del-0042` still show `delivery`, `pickup`. Allow ~7 s for shop-api to pick up the change.

**Say:**
- "I clicked that. A person approved it. It's not automatic."
- "Only Mumbai moved to pickup. Bengaluru and Delhi are untouched. The business keeps taking orders."
- Open the audit log if time allows: "Every action logs before and after, read back from Flagsmith."

## Beat 6 · Provider fixed

**Click:** Demo controls → Provider b → **Clear outage**. Back to the incident page.

**Audience sees:** Provider probe card: pill `recovering`, then `healthy`; green dots; "ok so far for Ns of 60s needed". The **Start recovery at 5%** button stays disabled with a reason line.

**Say:**
- "I cleared the simulated outage. The controller doesn't take anyone's word for it. It sends its own test orders and waits for a minute of clean results."
- Use the minute: point at **Business impact** (orders saved, at-risk per minute) and **Provider evidence** (**Download JSON** / **Download CSV**): "That's the pack for the provider's SLA claim."

## Beat 7 · Gradual recovery

**Click:** **Start recovery at 5%**, once. No more clicks: the controller advances 10%, 50% and 100% itself.

**Audience sees:** the big % and the ladder (0% → 5% → 10% → 50% → 100%) climbing; Samples "x of 10 needed"; Error rate vs max; pill `guardrail: pass`; observed share. Mascot switches to working. Each step moves when samples and the 20 s window pass; the Timeline shows "automatic advance: guardrail passed" with actor `controller`.

**Say (first step):**
- "I clicked this one. A person starts the way back. 5% of Mumbai's customers, chosen by Flagsmith's stable hash; the same people stay in as the number grows."
- "From here nobody clicks. A step moves only when there's enough data and the error rate is under 5%. A breach rolls it back instead."

For later steps, say nothing or one phrase: "Guardrail passed, the controller advanced."

## Beat 8 · Rollback (Full mode only)

**When:** during 50%, as rehearsed on 24 Nov (rollback in 8 s). At 5% there are fewer canary orders, so it may take longer; test at rehearsal before choosing another step.

**Click:** Demo controls → Provider b → **Start outage**. Back to the incident page, watch.

**Audience sees:** pill `guardrail: breach`, then the split goes to 0% with no click (about 2 s at 50% on 25 Nov). Status returns to **Mitigated**; the mascot goes calm; Timeline shows the rollback. The start button is disabled with the cooldown reason.

**Say:**
- "I broke the provider again on purpose. That click was me."
- "What follows nobody clicked. The controller saw the error rate breach, set the split to 0%, and reopened the same ticket."
- "Cooldown: 60 s where it refuses to advance."

**Then:** Demo controls → **Clear outage**. Wait for cooldown and a healthy probe (~1 min), then repeat beat 7: one **Start recovery at 5%** click and the ladder runs again. Say: "Back to the start, as designed."

## Beat 9 · Resolve

**Click:** none. After 100% passes its guardrail the controller finishes recovery itself.

**Audience sees:** status **Resolved**; the mascot turns happy; "100% of mumbai's customers on delivery · fallback is off"; Storefront: `cust-mum-0142` shows `delivery`, `pickup` again.

**Say:** "Fallback off, everyone back on delivery. I clicked once to start; the controller did every step after that, and its name is on each audit row."

## Beat 10 · Close

**Click:** Close incident card → type a real note (for example "provider b outage; fallback for Mumbai only; recovered in steps; evidence downloaded") → **Close incident**.

**Audience sees:** status **Closed**, the note, time to mitigate, time to recover, orders and ₹ saved (Business impact).

**Say:**
- "Closing needs a person and a note. The ticket ends with a human's words."
- "NuBi tells you why. The controller takes the safe action and brings customers back gradually."

After the demo: `RUNBOOK.md` §6 (clear outages, `make load-stop`, scale shop-api to 0).

---

## If something breaks

| Symptom | Say | Do |
|---|---|---|
| No NuBi findings by ~8 min | "NuBi hasn't answered. I'll investigate myself and submit the findings as operator. The ticket will say so." | Open Grafana, find the failing provider, use the **Findings** form on the incident page (playbook and value dropdowns, summary). The pill reads `operator`. Never type NuBi's words or paste a made-up summary. |
| NuBi late but coming | "It's still working. Here's the evidence meanwhile." | Stay on Grafana and the playbook (beat 3). Don't submit the form while it may still arrive. |
| Approve spins | "Waiting for Flagsmith to confirm the change." | Wait up to ~30 s. Don't double-click. |
| Dashboard says "Controller unreachable" | "The controller is down. The store keeps working because shop-api doesn't depend on it." | `kubectl -n shop get pods`, `colima status`. Don't restart the controller mid-demo: its DB is `emptyDir` and all incidents vanish. |
| NudgeBee UI won't load | "NudgeBee's view is behind a tunnel that dropped." | Check `tunnels.sh` is running; carry on with Grafana and the playbook. |
| Start recovery stays locked past the healthy time | "It's still waiting on the guardrail." (read the reason line under the button) | Wait. Seen once on 24 Nov after a rollback. Don't restart anything. |
| Dashboard sends you to the login page | "The session expired." | Log in again as `admin` / `admin`. |
| A step sits at the same % for a long time | "It's waiting for enough orders in the window." | Check `make load-start`. Don't click Advance: the controller will move when the guardrail passes. |
| Alert never fires | "Let me check the load." | `make load-start`; shop-api scaled to 1. |

Other failures: `RUNBOOK.md` §5.

---

## Honesty rules (`ARCHITECTURE.md` §15)

**Never:**
- call a human click automatic. Approve, **Start recovery at 5%**, Close, and the outage clicks are mine. Only these are automatic: the alert, NuBi's investigation and `submit_findings`, the probe, every recovery step after the first (the playbook's `recovery.auto_advance`; the audit says "automatic advance"), and rollback.
- present typed text as NuBi output. Findings from the form are labelled `operator`, and I say so out loud.
- claim zero downtime. Mumbai delivery is off while the fallback is on.

**Say plainly:**
- "The provider outage is simulated: our partner-mock returns 500s. Providers a, b and c are mocks."
- "The load is synthetic: a generator sends the orders."
- "Real: the alert, the NuBi investigation on Sarvam, the MCP call, the Flagsmith changes, the automatic rollback."
- "Proposed, not built: the playbook editor, readiness drills, win-back messages."
- Rollback speed (2 s on 25 Nov, 8 s on 24 Nov) and the rest of the timings are from our rehearsals. Quote them as that, not as a guarantee.
