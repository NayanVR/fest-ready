# FestReady demo script (B8)

Stage script for `RUNBOOK.md` §4. Button and panel names are the real dashboard labels. Spoken lines are in quotes: say them short, in your own words.

Timings come from the 24 Nov rehearsal (`RUNBOOK.md` §4). Re-time everything after the 25 Nov rebuild and edit this file where the numbers differ. Where a label could differ from the build (Grafana panel names, NudgeBee menu names), the script says "check at rehearsal".

## Pick a mode

The real run is longer than a 5–7 min slot, because NuBi alone takes ~5–6 min after the outage.

| Mode | Slot | How |
|---|---|---|
| **Short** | ~6 min on stage | Click **Start outage** ~4½ min before you go on stage (during the pitch intro). The NuBi gap is then mostly gone. Run beats 3b–10. Skip the live rollback (beat 8) and say so. |
| **Full** | ~14 min | Click the outage when the demo starts. Run every beat, including the live rollback. |

## Timeline (T = the Start outage click)

| T | Beat | You click | Audience sees |
|---|---|---|---|
| −2:00 | 0 Pre-flight | reset (RUNBOOK §3), open tabs | clean Overview, no incidents |
| 0:00 | 1 Outage | Demo controls → Provider b → **Start outage** | pill "outage on" |
| ~1:30 | 2 Alert | Overview → incident ID | incident **Investigating**, no recommendation |
| 1:30–5:30 | 3 NuBi gap | NudgeBee, Playbooks, Grafana | NuBi working; the playbook; the evidence |
| ~5:30 | 4 Findings | read the Findings card | NuBi's summary, playbook, **Approve** |
| ~6:00 | 5 Approve | **Approve** | **Mitigated**; Mumbai pickup only |
| ~7:00 | 6 Provider fixed | Demo controls → **Clear outage** | probe dots go green; "ok … of 60s needed" |
| ~8:15 | 7 Canary | **Start recovery at 5%**, then **Advance to …%** | split % rises; samples, guardrail |
| ~9:30 | 8 Rollback (Full only) | **Start outage** during 50% | guardrail breach → 0%, **Mitigated**, cooldown |
| ~13:00 | 9 Resolve | **Finish recovery (fallback off)** | **Resolved**; 100% on delivery |
| ~13:30 | 10 Close | closing note → **Close incident** | **Closed**; impact numbers |

Short mode skips beat 8: it ends about 10:45 after T, so the on-stage part runs from ~4:30 to ~10:45, about 6 min.

---

## Beat 0 · Pre-flight (before the audience is watching)

- Reset per `RUNBOOK.md` §3: outages cleared, fresh controller DB, `make load-start`. Flagsmith is normal (Mumbai fallback on, split 0).
- `sh infra/nudgebee/tunnels.sh` is running in its own terminal.
- Tabs, in this order: **Overview** (`:3000`), **Demo controls**, **Storefront**, **Playbooks**, NudgeBee Troubleshoot (`localhost:18080`), Grafana (`localhost:3001`).
- Sidebar → operator name field: type your real name. Every click is logged under it, which backs up the honesty rules below.
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
- "Advance: operator. Rollback: automatic. Moving customers back needs a human. Moving them away from danger doesn't wait for one."

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

**Click:** **Start recovery at 5%**. When Advance is enabled: **Advance to 10%**, then **Advance to 50%**, then **Advance to 100%**.

**Audience sees:** the big % and the ladder (0% → 5% → 10% → 50% → 100%); Samples "x of 10 needed"; Error rate vs max; pill `guardrail: pass`; observed share. Advance stays disabled until samples and the 20 s window pass.

**Say (first step only):**
- "5% of Mumbai's customers, chosen by Flagsmith's stable hash. The same people stay in as the number grows."
- "The button unlocks only when there's enough data and the error rate is under 5%. I still have to click."

For later steps, say nothing or one phrase: "Guardrail passed, advancing."

## Beat 8 · Rollback (Full mode only)

**When:** during 50%, as rehearsed on 24 Nov (rollback in 8 s). At 5% there are fewer canary orders, so it may take longer; test at rehearsal before choosing another step.

**Click:** Demo controls → Provider b → **Start outage**. Back to the incident page, watch.

**Audience sees:** pill `guardrail: breach`, then the split goes to 0% with no click. Status returns to **Mitigated**; Timeline shows the rollback. **Advance** is disabled with the cooldown reason.

**Say:**
- "I broke the provider again on purpose. That click was me."
- "What follows nobody clicked. The controller saw the error rate breach, set the split to 0%, and reopened the same ticket."
- "Cooldown: 60 s where it refuses to advance."

**Then:** Demo controls → **Clear outage**. Wait for cooldown and a healthy probe (~1 min), then repeat beat 7 from **Start recovery at 5%**. Say: "Back to the start, as designed."

## Beat 9 · Resolve

**Click:** after the last step, **Finish recovery (fallback off)**.

**Audience sees:** status **Resolved**; "100% of mumbai's customers on delivery · fallback is off"; Storefront: `cust-mum-0142` shows `delivery`, `pickup` again.

**Say:** "Fallback off, everyone back on delivery. Every step up was a person's click."

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
| Advance stays locked past the healthy time | "It's still waiting on the guardrail." (read the reason line under the button) | Wait. Seen once on 24 Nov after a rollback. Don't restart anything. |
| Alert never fires | "Let me check the load." | `make load-start`; shop-api scaled to 1. |

Other failures: `RUNBOOK.md` §5.

---

## Honesty rules (`ARCHITECTURE.md` §15)

**Never:**
- call a human click automatic. Approve, every Advance, **Finish recovery**, Close, and both outage clicks are mine. Only these are automatic: the alert, NuBi's investigation and `submit_findings`, the probe, and rollback.
- present typed text as NuBi output. Findings from the form are labelled `operator`, and I say so out loud.
- claim zero downtime. Mumbai delivery is off while the fallback is on.

**Say plainly:**
- "The provider outage is simulated: our partner-mock returns 500s. Providers a, b and c are mocks."
- "The load is synthetic: a generator sends the orders."
- "Real: the alert, the NuBi investigation on Sarvam, the MCP call, the Flagsmith changes, the automatic rollback."
- "Proposed, not built: the playbook editor, readiness drills, win-back messages."
- Rollback speed (8 s) and the rest of the timings are from our 24 Nov rehearsal. Quote them as that, not as a guarantee.
