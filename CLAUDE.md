@AGENTS.md

## Supabase

Supabase is **self-hosted in Kubernetes** — it is always running. Never use `supabase.com`, the cloud dashboard, `supabase start`, or `supabase db push --local`.

To apply migrations or run SQL:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c "YOUR SQL HERE"
```

To run a migration file:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/000X_name.sql
```
