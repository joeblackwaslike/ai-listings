#!/usr/bin/env bash
# Deploy the self-hosted GitHub Actions runner in the k3s cluster.
# The runner handles all `deploy` jobs in .github/workflows/deploy.yml.
#
# Auth: uses a Personal Access Token (ACCESS_TOKEN) — NOT a one-time runner
# registration token. The myoung34/github-runner entrypoint mints a fresh
# registration token from the PAT on every start, so the runner self-heals
# across pod restarts. (A static RUNNER_TOKEN expires in ~1h and bricks the
# runner on the first restart.)
#
# Create a classic PAT with `repo` scope (or a fine-grained token with
# Administration: Read+Write on this repo): https://github.com/settings/tokens/new
#
# Usage: ACCESS_TOKEN=<pat> bash deployment/scripts/deploy-runner.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

NAMESPACE="github-runner"
MANIFESTS="$(git rev-parse --show-toplevel)/deployment/kubernetes/runner"

: "${ACCESS_TOKEN:?ACCESS_TOKEN is required (a GitHub PAT with repo scope — https://github.com/settings/tokens/new)}"

kubectl apply -f "${MANIFESTS}/namespace.yaml"
kubectl apply -f "${MANIFESTS}/rbac.yaml"

kubectl create secret generic github-runner-secret \
  --from-literal=ACCESS_TOKEN="${ACCESS_TOKEN}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "${MANIFESTS}/deployment.yaml"

echo "→ Waiting for runner pod..."
kubectl rollout status deployment/github-runner -n "${NAMESPACE}" --timeout=120s

echo ""
echo "✓ Runner deployed. It will appear at:"
echo "  https://github.com/joeblackwaslike/ai-listings/settings/actions/runners"
