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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
