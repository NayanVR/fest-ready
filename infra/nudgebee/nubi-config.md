# NudgeBee configuration text (for the `demo-mac` account)

This is configuration we wrote for NuBi, not NuBi output. NuBi's own text is only ever shown verbatim from `submit_findings`.

## MCP integration `festive-rush-controller` → LLM Instructions

> This is the recovery controller for the shop. Use it when investigating a DeliveryAvailabilityLow alert. First call list_playbooks to see the available playbooks, their descriptions, causes and allowed values. Investigate with your other tools (metrics, logs, Kubernetes state) to find which dimension value is affected and whether the cause is external (a third-party provider) or internal (our own change, such as a recent deployment). When your investigation is done, call submit_findings exactly once: pick the playbook whose description matches the failure and a value from its allowed values, or use playbook null if no playbook fits or the cause is internal. Put your findings in summary (3-5 sentences) and the key data points in evidence. If submit_findings returns accepted:false, read the error and correct your call.

## Account Context `festive-rush-recovery` (AI & Tools → Account Context → demo-mac)

Description: *How to hand investigation results to the shop's recovery controller.*

> This cluster runs an online shop. shop-api (namespace shop) takes orders; home-delivery orders are dispatched to an external courier provider per city through partner-mock (namespace providers). Useful metrics: shop_orders_total{city,mode,result}, courier_dispatch_total{city,provider,status}, courier_dispatch_duration_seconds. Failures can be external (a courier provider) or internal (our own change, such as a deployment or restart of shop-api).
>
> Rule for every investigation of a DeliveryAvailabilityLow alert: the shop's recovery controller must receive your conclusion. It is connected as the MCP server festive-rush-controller. As part of the investigation, call its list_playbooks tool, determine from the evidence which dimension value is affected and whether the cause is external or internal, and finish by calling its submit_findings tool exactly once (playbook and value from list_playbooks, or playbook null if none fits or the cause is internal; summary of 3-5 sentences; evidence as key data points). If submit_findings returns accepted:false, read the error and correct the call. Do not skip submit_findings.

Neither text names the affected city, provider or cause; NuBi decides those from the evidence.

## Automation `festive-rush investigate delivery alert`

See `automation.json`. To recreate: Automations → Create Automation → account `demo-mac` → Create from Code → paste it → Publish → History → set the version **Active**.
