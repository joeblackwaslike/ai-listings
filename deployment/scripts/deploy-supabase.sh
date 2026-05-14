#!/usr/bin/env bash
# Deploy a dedicated Supabase instance for ai-listings in namespace sup-ai-listings.
# Follows the namespaced-Supabase runbook exactly (helm chart + mandatory post-install patches).
#
# First run:  generates fresh secrets and exports them to env.
# Repeat run: re-reads secrets from the existing k8s secret (idempotent).
#
# Usage: bash deployment/scripts/deploy-supabase.sh
# Must be run from the repo root.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

PROJECT="ai-listings"
NAMESPACE="sup-${PROJECT}"
CHART_RELEASE="${PROJECT}"
TS_HOSTNAME="sup-${PROJECT}"
VALUES_TEMPLATE="$(git rev-parse --show-toplevel)/deployment/kubernetes/supabase/values.yaml.template"
VALUES_FILE="/tmp/supabase-${PROJECT}-values.yaml"

cd "$(git rev-parse --show-toplevel)"

# ── Step 1: Helm repo ────────────────────────────────────────────────────────
echo "→ Adding supabase-community helm repo..."
helm repo add supabase https://supabase-community.github.io/supabase-kubernetes 2>/dev/null || true
helm repo update supabase

# ── Step 2: Generate or load secrets ─────────────────────────────────────────
SECRET_K8S_NAME="${CHART_RELEASE}-supabase-jwt"

if kubectl get secret "${SECRET_K8S_NAME}" -n "${NAMESPACE}" &>/dev/null; then
  echo "→ Existing secrets found in cluster — loading..."
  JWT_SECRET=$(kubectl get secret "${SECRET_K8S_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.data.secret}' | base64 -d)
  ANON_KEY=$(kubectl get secret "${SECRET_K8S_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.data.anonKey}' | base64 -d)
  SERVICE_KEY=$(kubectl get secret "${SECRET_K8S_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.data.serviceKey}' | base64 -d)
  DB_SECRET_NAME="${CHART_RELEASE}-supabase-db"
  DB_PASS=$(kubectl get secret "${DB_SECRET_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.data.password}' | base64 -d 2>/dev/null || echo "")
  if [[ -z "${DB_PASS}" ]]; then
    DB_PASS=$(kubectl get secret "${DB_SECRET_NAME}" -n "${NAMESPACE}" \
      -o jsonpath='{.data.DB_PASS}' | base64 -d 2>/dev/null || echo "changeme")
  fi
  DASH_PASS="$(openssl rand -base64 16)"
  LOGFLARE_PUB="$(openssl rand -base64 32)"
  LOGFLARE_PRIV="$(openssl rand -base64 32)"
else
  echo "→ Generating fresh secrets..."
  eval "$(python3 - << 'PYEOF'
import secrets, base64, json, time, hmac, hashlib

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def make_jwt(payload, secret):
    header  = b64url(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
    body    = b64url(json.dumps(payload).encode())
    sig_input = f"{header}.{body}".encode()
    sig     = b64url(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"

jwt_secret    = secrets.token_urlsafe(40)
db_pass       = secrets.token_urlsafe(24)
dashboard_pass= secrets.token_urlsafe(16)
logflare_pub  = secrets.token_urlsafe(32)
logflare_priv = secrets.token_urlsafe(32)

iat = int(time.time())
exp = iat + 10 * 365 * 24 * 3600

anon_key = make_jwt({"role":"anon",         "iss":"supabase","iat":iat,"exp":exp}, jwt_secret)
svc_key  = make_jwt({"role":"service_role", "iss":"supabase","iat":iat,"exp":exp}, jwt_secret)

print(f"export JWT_SECRET='{jwt_secret}'")
print(f"export DB_PASS='{db_pass}'")
print(f"export DASH_PASS='{dashboard_pass}'")
print(f"export LOGFLARE_PUB='{logflare_pub}'")
print(f"export LOGFLARE_PRIV='{logflare_priv}'")
print(f"export ANON_KEY='{anon_key}'")
print(f"export SERVICE_KEY='{svc_key}'")
PYEOF
)"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  SAVE THESE TO 1PASSWORD UNDER \"Supabase ai-listings\":"
  echo "  JWT_SECRET=${JWT_SECRET}"
  echo "  DB_PASS=${DB_PASS}"
  echo "  ANON_KEY=${ANON_KEY}"
  echo "  SERVICE_KEY=${SERVICE_KEY}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi

# ── Step 3: Render values file ────────────────────────────────────────────────
echo "→ Rendering Helm values..."
export JWT_SECRET DB_PASS DASH_PASS LOGFLARE_PUB LOGFLARE_PRIV ANON_KEY SERVICE_KEY
envsubst < "${VALUES_TEMPLATE}" > "${VALUES_FILE}"

# ── Step 4: Install ───────────────────────────────────────────────────────────
echo "→ Creating namespace ${NAMESPACE}..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "→ Running helm upgrade --install..."
helm upgrade --install "${CHART_RELEASE}" supabase/supabase \
  --namespace "${NAMESPACE}" \
  --values "${VALUES_FILE}" \
  --version 0.5.6 \
  --wait=false

echo "→ Waiting for DB pod (up to 5 min)..."
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=supabase-db \
  -n "${NAMESPACE}" \
  --timeout=300s

# ── Step 5a: Minio fsGroup patch ──────────────────────────────────────────────
echo "→ Patching Minio securityContext (fsGroup fix)..."
kubectl patch deployment "${CHART_RELEASE}-supabase-minio" \
  -n "${NAMESPACE}" \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/securityContext","value":{"fsGroup":1000,"runAsUser":1000,"runAsNonRoot":true}}]'

# ── Step 5b: Functions nodeName patch ────────────────────────────────────────
echo "→ Detecting Studio node for Functions pin..."
STUDIO_NODE=$(kubectl get pods -n "${NAMESPACE}" \
  -l app.kubernetes.io/name=supabase-studio \
  -o jsonpath='{.items[0].spec.nodeName}' 2>/dev/null || echo "")

if [[ -n "${STUDIO_NODE}" ]]; then
  echo "→ Pinning Functions to ${STUDIO_NODE}..."
  kubectl patch deployment "${CHART_RELEASE}-supabase-functions" \
    -n "${NAMESPACE}" \
    --type=json \
    -p="[{\"op\":\"add\",\"path\":\"/spec/template/spec/nodeName\",\"value\":\"${STUDIO_NODE}\"}]"

  # After the patch, the old ReplicaSet pod holds the RWO PVC that Studio also needs.
  # Cycle replicas to 0→1 so the new (patched) pod gets clean PVC access.
  echo "→ Cycling Functions replicas to release RWO PVC lock..."
  kubectl scale deployment "${CHART_RELEASE}-supabase-functions" -n "${NAMESPACE}" --replicas=0
  sleep 8
  kubectl scale deployment "${CHART_RELEASE}-supabase-functions" -n "${NAMESPACE}" --replicas=1
else
  echo "⚠ Studio not scheduled yet — skipping Functions pin. Re-run after Studio is Running:"
  echo "  bash deployment/scripts/deploy-supabase.sh patch-functions-only"
fi

# ── Step 5c: Wait for all pods ────────────────────────────────────────────────
echo "→ Waiting up to 3 min for all pods to stabilize..."
sleep 10
kubectl get pods -n "${NAMESPACE}"

# ── Step 6: Tailscale ingress ─────────────────────────────────────────────────
echo "→ Applying Tailscale ingress..."
kubectl apply -f "$(git rev-parse --show-toplevel)/deployment/kubernetes/supabase/ingress.yaml"

echo ""
echo "✓ Supabase deployed at: https://${TS_HOSTNAME}.napoleon-catfish.ts.net"
echo "  ANON_KEY: ${ANON_KEY}"
echo "  SERVICE_KEY: ${SERVICE_KEY}"
echo ""
echo "Next steps:"
echo "  bash deployment/scripts/migrate.sh"
echo "  bash deployment/scripts/deploy-app.sh"
