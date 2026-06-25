#!/usr/bin/env bash
# Deploy the ai-listings Next.js app to the ai-listings namespace.
# Extracts Supabase keys from the cluster automatically.
#
# Required env vars (from .env.local):
#   GHCR_TOKEN, ANTHROPIC_API_KEY, SERPAPI_API_KEY, WITHOUTBG_API_KEY,
#   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#   INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY, ALLOWED_EMAILS, AGENT_BYPASS_TOKEN,
#   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_BUCKET_NAME, R2_PUBLIC_URL
#
# Optional:
#   EBAY_USER_REFRESH_TOKEN, IMAGE_TAG (default: latest)
#
# Usage: bash deployment/scripts/deploy-app.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

APP_NAMESPACE="ai-listings"
SUPA_NAMESPACE="sup-ai-listings"
SUPA_RELEASE="ai-listings"
IMAGE="ghcr.io/joeblackwaslike/ai-listings"
TAG="${IMAGE_TAG:-latest}"
MANIFESTS="$(git rev-parse --show-toplevel)/deployment/kubernetes/app"

cd "$(git rev-parse --show-toplevel)"

# ── Validate required env vars ────────────────────────────────────────────────
REQUIRED=(
  GHCR_TOKEN
  ANTHROPIC_API_KEY
  SERPAPI_API_KEY
  WITHOUTBG_API_KEY
  EBAY_CLIENT_ID
  EBAY_CLIENT_SECRET
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  INNGEST_SIGNING_KEY
  INNGEST_EVENT_KEY
  ALLOWED_EMAILS
  AGENT_BYPASS_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  R2_BUCKET_NAME
  R2_PUBLIC_URL
)
missing=()
for var in "${REQUIRED[@]}"; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required env vars: ${missing[*]}"
  exit 1
fi

# ── Extract Supabase keys from cluster ────────────────────────────────────────
echo "→ Extracting Supabase keys from ${SUPA_NAMESPACE}..."
JWT_SECRET_NAME="${SUPA_RELEASE}-supabase-jwt"

ANON_KEY=$(kubectl get secret "${JWT_SECRET_NAME}" -n "${SUPA_NAMESPACE}" \
  -o jsonpath='{.data.anonKey}' | base64 -d)
SERVICE_KEY=$(kubectl get secret "${JWT_SECRET_NAME}" -n "${SUPA_NAMESPACE}" \
  -o jsonpath='{.data.serviceKey}' | base64 -d)

if [[ -z "${ANON_KEY}" || -z "${SERVICE_KEY}" ]]; then
  echo "ERROR: Could not read Supabase JWT keys from secret ${JWT_SECRET_NAME} in ${SUPA_NAMESPACE}"
  echo "       Make sure deploy-supabase.sh has been run first."
  exit 1
fi

# ── Namespace ─────────────────────────────────────────────────────────────────
echo "→ Creating namespace ${APP_NAMESPACE}..."
kubectl create namespace "${APP_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# ── imagePullSecret for ghcr.io ───────────────────────────────────────────────
echo "→ Creating/updating ghcr-credentials imagePullSecret..."
kubectl create secret docker-registry ghcr-credentials \
  --docker-server=ghcr.io \
  --docker-username=joeblackwaslike \
  --docker-password="${GHCR_TOKEN}" \
  -n "${APP_NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

# ── Generate secret.yaml ──────────────────────────────────────────────────────
echo "→ Generating deployment/kubernetes/app/secret.yaml..."
cat > "${MANIFESTS}/secret.yaml" << EOF
apiVersion: v1
kind: Secret
metadata:
  name: ai-listings-secret
  namespace: ai-listings
type: Opaque
stringData:
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "${ANON_KEY}"
  SUPABASE_SERVICE_ROLE_KEY: "${SERVICE_KEY}"
  ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
  SERPAPI_API_KEY: "${SERPAPI_API_KEY}"
  WITHOUTBG_API_KEY: "${WITHOUTBG_API_KEY}"
  EBAY_CLIENT_ID: "${EBAY_CLIENT_ID}"
  EBAY_CLIENT_SECRET: "${EBAY_CLIENT_SECRET}"
  EBAY_APP_TOKEN: "${EBAY_APP_TOKEN:-}"
  EBAY_USER_REFRESH_TOKEN: "${EBAY_USER_REFRESH_TOKEN:-}"
  INNGEST_SIGNING_KEY: "${INNGEST_SIGNING_KEY}"
  INNGEST_EVENT_KEY: "${INNGEST_EVENT_KEY}"
  GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID}"
  GOOGLE_CLIENT_SECRET: "${GOOGLE_CLIENT_SECRET}"
  ALLOWED_EMAILS: "${ALLOWED_EMAILS}"
  AGENT_BYPASS_TOKEN: "${AGENT_BYPASS_TOKEN}"
  CLOUDFLARE_ACCOUNT_ID: "${CLOUDFLARE_ACCOUNT_ID}"
  CLOUDFLARE_API_TOKEN: "${CLOUDFLARE_API_TOKEN}"
  R2_BUCKET_NAME: "${R2_BUCKET_NAME}"
  R2_PUBLIC_URL: "${R2_PUBLIC_URL}"
EOF

# ── Apply manifests ───────────────────────────────────────────────────────────
echo "→ Applying app manifests..."
kubectl apply -f "${MANIFESTS}/namespace.yaml"
kubectl apply -f "${MANIFESTS}/configmap.yaml"
kubectl apply -f "${MANIFESTS}/secret.yaml"
kubectl apply -f "${MANIFESTS}/service.yaml"

# Patch image tag before applying deployment
sed "s|ghcr.io/joeblackwaslike/ai-listings:latest|${IMAGE}:${TAG}|g" \
  "${MANIFESTS}/deployment.yaml" | kubectl apply -f -

kubectl apply -f "${MANIFESTS}/ingress.yaml"

# ── Wait for rollout ──────────────────────────────────────────────────────────
echo "→ Waiting for rollout..."
kubectl rollout status deployment/ai-listings -n "${APP_NAMESPACE}" --timeout=300s

echo ""
echo "✓ ai-listings deployed at: https://ai-listings.napoleon-catfish.ts.net"
