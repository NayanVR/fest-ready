# Files to recreate in a new project

The docs are portable on their own; these few non-markdown files are not, so their exact contents live here. **First setup step in an empty project:** create each file below at the given path with exactly this content (an agent can do it: *"Create every file in docs/FILES.md verbatim, then `chmod +x infra/nudgebee/*.sh`"*). Secrets are never here: the real `.env` comes by AirDrop.

`infra/nudgebee/sarvam-shim.yaml` is already deployed on the NudgeBee VM; it is here so the setup can be rebuilt. `nubi-config.md` and `automation.json` describe what is already configured in NudgeBee (used for the backup Mac, A7).

## `CLAUDE.md`

````markdown
@AGENTS.md
````

## `.gitignore`

````gitignore
.env
node_modules/
data/
.next/
dist/
````

## `.env.example`

````sh
# Copy to .env (git-ignored). Shared by AirDrop. See docs/CONTRACTS.md §7.

# shop-api
FLAGSMITH_SERVER_KEY=

# controller only
FLAGSMITH_MGMT_TOKEN=
FLAGSMITH_PROJECT_ID=
FLAGSMITH_ENV_ID=
PROMETHEUS_URL=
PLAYBOOK_DIR=./playbooks
DB_PATH=./data/controller.db

# shared
ADMIN_SECRET=
PARTNER_URL=http://localhost:4003
CONTROLLER_URL=
SHOP_URL=

# load-generator
RATE_PER_SEC=5
DURATION_SEC=600
DELIVERY_RATIO=0.7

# dashboard
DEMO_PROVIDERS=a,b,c

# NudgeBee on the demo Mac — see docs/RUNBOOK.md
NUDGEBEE_AGENT_AUTH_KEY=
NUDGEBEE_FORAGER_ACCESS_KEY=
NUDGEBEE_FORAGER_ACCESS_SECRET=
NUDGEBEE_WEBHOOK_URL=http://nudgebee-agent-runner.nudgebee.svc/api/alerts
GCLOUD=gcloud
NUDGEBEE_VM=instance-20261124-125212
NUDGEBEE_VM_ZONE=asia-south1-a
````

## `infra/nudgebee/tunnels.sh`

````sh
#!/bin/sh
# Keep SSH tunnels from this Mac to the NudgeBee VM open (localhost only), reconnecting on drops.
#   18080 -> NudgeBee UI (svc app:80)   18081 -> relay (svc relay-server:8080)   18082 -> collector (svc k8s-collector:80)
# Run from the repo root in its own terminal: sh infra/nudgebee/tunnels.sh
set -u
[ -f .env ] && { set -a; . ./.env; set +a; }
G=${GCLOUD:-gcloud}; VM=${NUDGEBEE_VM:?}; ZONE=${NUDGEBEE_VM_ZONE:?}
ip() { "$G" compute ssh "$VM" --zone "$ZONE" --quiet --command "sudo -n k3s kubectl -n nudgebee get svc $1 -o jsonpath={.spec.clusterIP}" 2>/dev/null | tail -1; }
APP=$(ip app); RELAY=$(ip relay-server); COLL=$(ip k8s-collector)
echo "app=$APP relay=$RELAY collector=$COLL"
while true; do
  "$G" compute ssh "$VM" --zone "$ZONE" --quiet -- -N -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:18080:$APP:80" -L "127.0.0.1:18081:$RELAY:8080" -L "127.0.0.1:18082:$COLL:80"
  echo "$(date -u +%T) tunnel dropped, reconnecting in 5s"; sleep 5
done
````

## `infra/nudgebee/install-agents.sh`

````sh
#!/bin/sh
# Install the NudgeBee agent and the MCP proxy agent (forager) on the local KinD cluster.
# Needs: tunnels.sh running, and NUDGEBEE_AGENT_AUTH_KEY / NUDGEBEE_FORAGER_ACCESS_* in .env.
set -eu
[ -f .env ] && { set -a; . ./.env; set +a; }
CTX=${KUBE_CONTEXT:-kind-rehearsal}
helm repo add nudgebee-agent https://nudgebee.github.io/k8s-agent/ >/dev/null 2>&1 || true
helm repo update nudgebee-agent >/dev/null
helm upgrade --install nudgebee-agent nudgebee-agent/nudgebee-agent --kube-context "$CTX" -n nudgebee --create-namespace --version 0.1.32 \
  --set runner.nudgebee.auth_secret_key="$NUDGEBEE_AGENT_AUTH_KEY" \
  --set runner.relay_address="ws://host.docker.internal:18081/register" \
  --set runner.nudgebee.endpoint="http://host.docker.internal:18082" \
  --set enablePrometheusStack=false --set opencost.enabled=false \
  --set opentelemetry-collector.enabled=false --set clickhouse.enabled=false
helm upgrade --install nudgebee-forager oci://registry.nudgebee.com/nudgebee-forager-chart --kube-context "$CTX" -n nudgebee \
  --set forager.accessKey="$NUDGEBEE_FORAGER_ACCESS_KEY" \
  --set forager.accessSecret="$NUDGEBEE_FORAGER_ACCESS_SECRET" \
  --set forager.relayURL="ws://host.docker.internal:18081/register"
kubectl --context "$CTX" -n nudgebee wait --for=condition=Available deploy --all --timeout=180s
````

## `infra/nudgebee/sarvam-shim.yaml`

````yaml
apiVersion: v1
kind: Namespace
metadata: {name: festive-shim}
---
apiVersion: v1
kind: ConfigMap
metadata: {name: sarvam-shim, namespace: festive-shim}
data:
  shim.ts: |
    // Sarvam ignores max_completion_tokens and defaults to 2048 output tokens, which a reasoning
    // model spends entirely on thinking. Rewrite to max_tokens and pass everything else through.
    const MAX = Number(process.env.MAX_TOKENS ?? 16384);
    Bun.serve({ port: 8080, idleTimeout: 255, async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/healthz") return Response.json({ ok: true });
      let body: string | undefined = req.method === "POST" ? await req.text() : undefined;
      if (body) { try {
        const j = JSON.parse(body);
        console.log(JSON.stringify({ path: u.pathname, model: j.model, stream: j.stream, max_tokens: j.max_tokens, max_completion_tokens: j.max_completion_tokens }));
        const n = j.max_completion_tokens ?? j.max_tokens ?? 0;
        delete j.max_completion_tokens;
        j.max_tokens = Math.max(n, MAX);
        body = JSON.stringify(j);
      } catch {} }
      const h = new Headers(req.headers);
      for (const k of ["host", "content-length", "accept-encoding"]) h.delete(k);
      const r = await fetch("https://api.sarvam.ai" + u.pathname + u.search, { method: req.method, headers: h, body });
      const rh = new Headers(r.headers);
      for (const k of ["content-encoding", "content-length", "transfer-encoding"]) rh.delete(k);
      return new Response(r.body, { status: r.status, headers: rh });
    }});
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: sarvam-shim, namespace: festive-shim}
spec:
  replicas: 1
  selector: {matchLabels: {app: sarvam-shim}}
  template:
    metadata: {labels: {app: sarvam-shim}}
    spec:
      containers:
      - name: shim
        image: oven/bun:1.3-slim
        command: ["bun", "/app/shim.ts"]
        ports: [{containerPort: 8080}]
        readinessProbe: {httpGet: {path: /healthz, port: 8080}}
        volumeMounts: [{name: app, mountPath: /app}]
      volumes: [{name: app, configMap: {name: sarvam-shim}}]
---
apiVersion: v1
kind: Service
metadata: {name: sarvam-shim, namespace: festive-shim}
spec:
  selector: {app: sarvam-shim}
  ports: [{port: 80, targetPort: 8080}]
````

## `infra/nudgebee/automation.json`

````json
{
  "name": "festive-rush investigate delivery alert",
  "definition": {
    "version": "v1",
    "timeout": "20m",
    "inputs": [],
    "output": {},
    "tasks": [
      {
        "id": "llm_event_investigate",
        "type": "llm.event_investigate",
        "params": {
          "account_id": "3ea2aa97-1ed9-4977-9498-857de597b5cb",
          "event_id": "{{ Inputs.event.id }}"
        }
      },
      {
        "id": "llm_nubi",
        "type": "llm.nubi",
        "params": {
          "account_id": "3ea2aa97-1ed9-4977-9498-857de597b5cb",
          "approved_tools": [],
          "message": "A {{ Inputs.event.event_type }} alert fired on cluster {{ Inputs.event.cluster }} at {{ Inputs.event.starts_at }} (NudgeBee event {{ Inputs.event.id }}). Investigate it using current metrics, logs and Kubernetes state, and follow the account rules for this alert, including reporting your conclusion to the festive-rush-controller MCP server.",
          "session_scope": "execution"
        }
      }
    ],
    "triggers": [
      {
        "type": "event",
        "params": { "filter": "{{ event.event_type == \"DeliveryAvailabilityLow\" }}" }
      }
    ],
    "retry_policy": { "maximum_attempts": 3, "initial_interval": "1s", "maximum_interval": "1m", "backoff_coefficient": 2 }
  },
  "tags": {},
  "status": "ACTIVE"
}
````

## `infra/nudgebee/nubi-config.md`

````markdown
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
````
