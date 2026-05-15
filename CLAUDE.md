@AGENTS.md

## Environments

There are two env files — both are gitignored:

| File | Used when | Points to |
| --- | --- | --- |
| `.env.local` | `next dev` (local development) | k8s Supabase via Tailscale (same DB as prod — requires Tailscale connected) |
| `.env.production.local` | `next build` / Kubernetes deployment | k8s Supabase via internal cluster DNS |

**Production is Kubernetes.** The app and all its dependencies (Supabase, Inngest) run in the cluster at `napoleon-catfish.ts.net`. There is no separate staging environment.

Key production URLs (from `.env.production.local`):

- App: `https://ai-listings.napoleon-catfish.ts.net`
- Supabase (public): `https://sup-ai-listings.napoleon-catfish.ts.net`
- Supabase (internal, server-side): `http://ai-listings-supabase-kong.sup-ai-listings.svc.cluster.local:8000`
- Inngest (internal): `http://inngest.ai-listings.svc.cluster.local:8288`

## Supabase

Supabase is **self-hosted in Kubernetes** — it is always running. Never use `supabase.com`, the cloud dashboard, `supabase start`, or `supabase db push`.

Kubernetes namespaces:

- `sup-ai-listings` — Supabase (DB, auth, storage, Kong, etc.)
- `ai-listings` — the Next.js app + Inngest

To apply a migration or run SQL in production:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c "SQL HERE"
```

To pipe a migration file:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/000X_name.sql
```

To inspect production env vars:

```bash
kubectl get secret -n ai-listings ai-listings-secret -o jsonpath='{.data}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));Object.entries(d).forEach(([k,v])=>console.log(k+'='+Buffer.from(v,'base64').toString()))"
kubectl get configmap -n ai-listings ai-listings-config -o jsonpath='{.data}'
```
