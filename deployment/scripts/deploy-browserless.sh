#!/usr/bin/env bash
# Deploy Browserless to the ai-listings namespace.
#
# Required env vars:
#   BROWSERLESS_TOKEN  (random secret string — generate once, store in 1Password)
#
# Usage: bash deployment/scripts/deploy-browserless.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

APP_NAMESPACE="ai-listings"
MANIFESTS="$(git rev-parse --show-toplevel)/deployment/kubernetes/browserless"

cd "$(git rev-parse --show-toplevel)"

if [[ -z "${BROWSERLESS_TOKEN:-}" ]]; then
  echo "ERROR: BROWSERLESS_TOKEN is required"
  exit 1
fi

echo "→ Creating namespace ${APP_NAMESPACE}..."
kubectl create namespace "${APP_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "→ Creating/updating browserless-secret..."
kubectl create secret generic browserless-secret \
  --from-literal=BROWSERLESS_TOKEN="${BROWSERLESS_TOKEN}" \
  -n "${APP_NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "→ Applying browserless manifests..."
kubectl apply -f "${MANIFESTS}/service.yaml"
kubectl apply -f "${MANIFESTS}/deployment.yaml"
kubectl apply -f "${MANIFESTS}/ingress.yaml"

echo "→ Restarting browserless to pick up any secret changes..."
kubectl rollout restart deployment/browserless -n "${APP_NAMESPACE}"

echo "→ Waiting for rollout..."
kubectl rollout status deployment/browserless -n "${APP_NAMESPACE}" --timeout=120s

echo ""
echo "✓ Browserless deployed at: https://browserless.napoleon-catfish.ts.net"
