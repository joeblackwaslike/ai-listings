#!/usr/bin/env bash
# Apply SQL migrations to the Supabase DB pod in sup-ai-listings namespace.
# Usage: bash deployment/scripts/migrate.sh
# Must be run from the repo root.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

NAMESPACE="sup-ai-listings"
cd "$(git rev-parse --show-toplevel)"

echo "Waiting for DB pod to be ready..."
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=supabase-db \
  -n "${NAMESPACE}" \
  --timeout=120s

DB_POD=$(kubectl get pod -n "${NAMESPACE}" \
  -l app.kubernetes.io/name=supabase-db \
  -o jsonpath='{.items[0].metadata.name}')

echo "DB pod: ${DB_POD}"

for f in supabase/migrations/*.sql; do
  echo "Applying ${f}..."
  kubectl exec -n "${NAMESPACE}" "${DB_POD}" \
    -- psql -U postgres -d postgres < "${f}"
  echo "  OK"
done

echo "All migrations applied."
