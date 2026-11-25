#!/bin/sh
set -eu

set -a
. ./.env
set +a

: "${KUBE_CONTEXT:?}" "${ADMIN_SECRET:?}"
if [ "${1:-false}" = true ]; then
  : "${FLAGSMITH_MGMT_TOKEN:?}" "${FLAGSMITH_PROJECT_ID:?}" "${FLAGSMITH_ENV_ID:?}"
fi

apply_secret() {
  manifest=$(kubectl --context "$KUBE_CONTEXT" -n "$1" create secret generic "${2:-app-secrets}" \
    --from-env-file=/dev/stdin --dry-run=client -o json)
  printf '%s' "$manifest" | kubectl --context "$KUBE_CONTEXT" apply --server-side -f -
}

printf 'ADMIN_SECRET=%s\n' "$ADMIN_SECRET" | apply_secret providers
{
  printf 'ADMIN_SECRET=%s\n' "$ADMIN_SECRET"
  for key in FLAGSMITH_SERVER_KEY FLAGSMITH_MGMT_TOKEN FLAGSMITH_PROJECT_ID FLAGSMITH_ENV_ID SARVAM_API_KEY; do
    value=$(printenv "$key" || true)
    if [ -n "$value" ]; then
      printf '%s=%s\n' "$key" "$value"
    fi
  done
} | apply_secret shop

{
  for key in SARVAM_VOICE_API_KEY SARVAM_VOICE_ORG_ID SARVAM_VOICE_WORKSPACE_ID \
    SARVAM_VOICE_APP_ID SARVAM_VOICE_APP_VERSION SARVAM_VOICE_CONNECTION_ID SARVAM_VOICE_FROM_NUMBER; do
    value=$(printenv "$key" || true)
    if [ -n "$value" ]; then
      printf '%s=%s\n' "$key" "$value"
    fi
  done
} | apply_secret shop sarvam-voice
