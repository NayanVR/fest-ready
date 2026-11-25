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
