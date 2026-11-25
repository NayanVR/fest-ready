#!/bin/sh
set -eu

context=${1:?Kubernetes context is required}
: "${NUDGEBEE_WEBHOOK_URL:?Set NUDGEBEE_WEBHOOK_URL in .env}"
monitoring_dir=$(dirname "$0")

kubectl --context "$context" create namespace monitoring --dry-run=client -o yaml |
    kubectl --context "$context" apply -f -

secret=$(printf '%s' "$NUDGEBEE_WEBHOOK_URL" |
    kubectl --context "$context" -n monitoring create secret generic nudgebee-webhook \
        --from-file=url=/dev/stdin --dry-run=client -o yaml)
printf '%s\n' "$secret" |
    kubectl --context "$context" -n monitoring apply --server-side -f -
unset secret

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
    --version 93.9.0 --kube-context "$context" -n monitoring -f "$monitoring_dir/values.yaml" --wait
kubectl --context "$context" wait --for=condition=Established --timeout=60s \
    crd/servicemonitors.monitoring.coreos.com crd/prometheusrules.monitoring.coreos.com
kubectl --context "$context" apply -f "$monitoring_dir/resources.yaml"
