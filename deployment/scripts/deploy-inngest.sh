#!/usr/bin/env bash
# Deploy the self-hosted Inngest dev-server in the k3s cluster. It's the durable-execution
# engine behind every pipeline background job (intake, resume, retry-step, condition
# reassessment, photo-quality-gate, cron jobs) -- a single-replica `inngest dev` process
# with local SQLite storage (--sqlite-dir /data, no persistent volume: run history is lost
# on pod restart, in-flight function state is not -- Inngest's SDK-side step memoization
# lives in the app's own DB writes, not here).
#
# Depends on deploy-app.sh having already run in this cluster: reuses its ghcr-credentials
# imagePullSecret and reads INNGEST_SIGNING_KEY/INNGEST_EVENT_KEY out of its ai-listings-secret
# (see deployment/kubernetes/inngest/deployment.yaml) rather than provisioning its own.
#
# Usage: bash deployment/scripts/deploy-inngest.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

NAMESPACE="ai-listings"
MANIFESTS="$(git rev-parse --show-toplevel)/deployment/kubernetes/inngest"

kubectl get secret ai-listings-secret -n "${NAMESPACE}" >/dev/null 2>&1 || {
  echo "✗ ai-listings-secret not found in namespace ${NAMESPACE} -- run deploy-app.sh first." >&2
  exit 1
}

kubectl apply -f "${MANIFESTS}/deployment.yaml"
kubectl apply -f "${MANIFESTS}/ingress.yaml"

echo "→ Waiting for inngest pod..."
kubectl rollout status deployment/inngest -n "${NAMESPACE}" --timeout=120s

echo ""
echo "✓ Inngest deployed. Dashboard (self-hosted dev-server UI, no auth beyond Tailscale ACLs):"
echo "  https://ai-listings-inngest.napoleon-catfish.ts.net"
