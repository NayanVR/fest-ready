#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
demo_project="festready-payment-smoke-$$"
export PAYMENT_DEMO_PORT=${PAYMENT_DEMO_SMOKE_PORT:-3101}
dashboard="http://127.0.0.1:$PAYMENT_DEMO_PORT"
test_dir=$(mktemp -d)
response="$test_dir/response.json"
compose() {
  docker compose --env-file /dev/null -p "$demo_project" -f infra/payment-demo/compose.yaml "$@"
}
cleanup() {
  compose down >/dev/null 2>&1 || true
  rm -r "$test_dir"
}
trap cleanup EXIT

request() {
  expected_status=$1 method=$2 route=$3
  shift 3
  actual_status=$(curl -sS --max-time 12 --output "$response" --write-out '%{http_code}' \
    --cookie "$test_dir/cookies" --cookie-jar "$test_dir/cookies" \
    --request "$method" "$dashboard$route" "$@")
  if [ "$actual_status" != "$expected_status" ]; then
    printf '%s %s returned HTTP %s, expected %s\n' "$method" "$route" "$actual_status" "$expected_status" >&2
    cat "$response" >&2
    exit 1
  fi
}
post() {
  request "$1" POST "$2" --header 'Content-Type: application/json' --data "$3"
}
pay() {
  post "$1" /api/shop/payments "$(jq -nc --arg provider "$2" '{provider:$provider,customerId:"smoke-customer",amount:100,synthetic:true}')"
}
outage() {
  post 200 /api/shop/payments/demo/outage "$(jq -nc --arg provider "$1" --argjson status "$2" '{provider:$provider,status:$status}')"
}

compose up --build -d --wait
post 200 /api/auth/signup '{"username":"smoke-operator","password":"sandbox-smoke-only"}'
request 200 GET /api/c/playbooks
jq -e 'length == 0' "$response" >/dev/null
for provider in alpha beta gamma; do
  pay 201 "$provider"
  jq -e --arg provider "$provider" '.provider == $provider and .route == "primary"' "$response" >/dev/null
done

playbook=$(cat <<'JSON'
{
  "id":"payment-provider-failover",
  "owner":"payments",
  "description":"Route simulated payment attempts to another available provider.",
  "match":{"alerts":["PaymentAvailabilityLow"],"cause":"external"},
  "dimension":{"name":"paymentCohort","trait":"paymentCohort","label":"paymentCohort","values":["alpha","beta","gamma"]},
  "flag":{"key":"payment_primary_enabled","normal":{"enabled":true},"fallback":{"enabled":false}},
  "segments":{"fallback":"payment-{value}-fallback","recovery":"payment-{value}-recovery"},
  "recovery":{"method":"split","steps":[5,10,50,100],"auto_advance":false,
    "guardrail":{"min_samples":10,"max_error_rate":0.05,"max_consecutive_errors":3,"window":"20s"},
    "cooldown_after_rollback":"60s"},
  "events":{"dimension_field":"paymentCohort","identity_field":"paymentCustomer","outcome_field":"paymentOutcome",
    "amount_field":"amount","canary_filter":{"paymentRoute":"primary"}},
  "probe":{"every":"10s","healthy_for":"60s","identities":{"alpha":"pay-probe-alpha","beta":"pay-probe-beta","gamma":"pay-probe-gamma"},
    "request":{"method":"POST","url":"${SHOP_URL}/api/payments","body":{"customerId":"{probe_identity}","provider":"{value}","amount":100,"synthetic":true}},
    "expect":{"healthy":{"status":201},"fallback_active":{"status":409}}}
}
JSON
)
post 201 /api/c/playbooks "$playbook"
jq -e '.id == "payment-provider-failover" and .version == 1' "$response" >/dev/null
deadline=$(( $(date +%s) + 10 ))
while :; do
  post 200 /api/c/playbook-wizard/readiness "$playbook"
  if jq -e '.readiness == "ready"' "$response" >/dev/null; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    cat "$response" >&2
    exit 1
  fi
  sleep 1
done

outage alpha 503
pay 502 alpha
jq -e '.error == "PAYMENT_UNAVAILABLE" and .preferredProvider == "alpha"' "$response" >/dev/null
pay 201 beta
jq -e '.provider == "beta" and .route == "primary"' "$response" >/dev/null
incident=""
deadline=$(( $(date +%s) + 15 ))
while [ -z "$incident" ] && [ "$(date +%s)" -lt "$deadline" ]; do
  request 200 GET /api/c/incidents
  incident=$(jq -r 'first(.[] | select(.alert == "PaymentAvailabilityLow") | .id) // empty' "$response")
  [ -n "$incident" ] || sleep 1
done
test -n "$incident"
incident_path="/api/c/incidents/$incident"
post 409 "$incident_path/approve" '{"actor":"smoke operator"}'
post 200 "$incident_path/findings" '{"source":"operator","actor":"smoke operator","playbook":"payment-provider-failover","value":"alpha","cause":"external","summary":"The Alpha mock returned a provider unavailable response."}'
post 200 "$incident_path/approve" '{"actor":"smoke operator"}'
jq -e '.recovery.state == "FALLBACK"' "$response" >/dev/null

pay 201 alpha
jq -e '.preferredProvider == "alpha" and (.provider == "beta" or .provider == "gamma") and .route == "fallback"' "$response" >/dev/null
pay 201 beta
jq -e '.provider == "beta" and .route == "primary"' "$response" >/dev/null
outage beta 503
pay 201 alpha
jq -e '.provider == "gamma" and .route == "fallback"' "$response" >/dev/null
outage alpha null
post 200 /api/c/playbook-wizard/probe "$(jq -nc --argjson playbook "$playbook" '{playbook:$playbook,value:"alpha"}')"
jq -e '.healthy == true and .status == 201' "$response" >/dev/null
printf '%s\n' 'Payment demo passed: created v1, observed primary failure, gated approval, routed to an available backup, and recovered the primary probe.'
