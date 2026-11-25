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
