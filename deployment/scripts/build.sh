#!/usr/bin/env bash
# Build and push ARM64 image to ghcr.io
# Usage: bash deployment/scripts/build.sh [tag]
# Must be run from the repo root.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"

IMAGE="ghcr.io/joeblackwaslike/ai-listings"
TAG="${1:-latest}"

cd "$(git rev-parse --show-toplevel)"

SUPABASE_URL=$(kubectl get configmap ai-listings-config -n ai-listings -o jsonpath='{.data.NEXT_PUBLIC_SUPABASE_URL}')
SUPABASE_ANON_KEY=$(kubectl get secret ai-listings-secret -n ai-listings -o jsonpath='{.data.NEXT_PUBLIC_SUPABASE_ANON_KEY}' | base64 -d)

echo "Building ${IMAGE}:${TAG} for linux/arm64..."
docker buildx build \
  --platform linux/arm64 \
  --file deployment/Dockerfile \
  --tag "${IMAGE}:${TAG}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}" \
  --push \
  .

echo "Done: ${IMAGE}:${TAG}"
