#!/usr/bin/env bash
# Deploy the self-hosted GitHub Actions runner in the k3s cluster.
# The runner handles all `deploy` jobs in .github/workflows/deploy.yml.
#
# One-time setup: Generate a runner token at:
#   https://github.com/joeblackwaslike/ai-listings/settings/actions/runners/new
#   (select Linux / ARM64 → copy the token from step 2 of the instructions)
#
# Usage: RUNNER_TOKEN=<token> bash deployment/scripts/deploy-runner.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

NAMESPACE="github-runner"
MANIFESTS="$(git rev-parse --show-toplevel)/deployment/kubernetes/runner"

: "${RUNNER_TOKEN:?RUNNER_TOKEN is required (from github.com/joeblackwaslike/ai-listings/settings/actions/runners/new)}"

kubectl apply -f "${MANIFESTS}/namespace.yaml"
kubectl apply -f "${MANIFESTS}/rbac.yaml"

kubectl create secret generic github-runner-secret \
  --from-literal=RUNNER_TOKEN="${RUNNER_TOKEN}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "${MANIFESTS}/deployment.yaml"

echo "→ Waiting for runner pod..."
kubectl rollout status deployment/github-runner -n "${NAMESPACE}" --timeout=120s

echo ""
echo "✓ Runner deployed. It will appear at:"
echo "  https://github.com/joeblackwaslike/ai-listings/settings/actions/runners"
