---
name: newrelic-observability
description: Use when investigating production behavior of ai-listings: errors in prod, "is it down", pod crashes or restarts, slow requests, why a sync or pipeline step failed, post-deploy verification, checking dashboards or alerts, or any mention of New Relic, NRQL, logs or APM. Pod logs, Kubernetes state and alerts all live in New Relic; use it before raw kubectl logs.
---

# New Relic for ai-listings

Every pod log in the cluster, Kubernetes state (restarts, replicas) and the alert policies are in New Relic. Query it with `scripts/nr.ts` instead of `kubectl logs` for anything older than a few minutes or spanning pods.

## Commands (run from the repo root)

```bash
bun scripts/nr.ts logs --errors --ns ai-listings --since "1 hours"   # real errors only
bun scripts/nr.ts logs --ns sup-ai-listings --grep "relation" --since "6 hours" --limit 20
bun scripts/nr.ts query "SELECT count(*) FROM Log SINCE 1 hour ago FACET container_name"
bun scripts/nr.ts audit --since "6 hours"                     # which workloads have logs; quiet vs dropped
```

Output is JSON. Pipe through `jq -c` and print only the fields you need. Log lines can contain user IDs and tokens, so show counts, patterns and short excerpts, never whole dumps.

Credentials come from `NEW_RELIC_API_KEY` and `NEW_RELIC_ACCOUNT_ID` in the environment or `.env.production.local`. Never print, log or commit the key.

## Where things are

| Question | Look at |
| --- | --- |
| App errors | `Log` where `namespace_name='ai-listings'` and `container_name='ai-listings'` |
| Background jobs | `container_name='inngest'` (server), lines starting `[sync-platform-...]`, `[ebay]` |
| Supabase | `Log` where `namespace_name='sup-ai-listings'` (`supabase-auth`, `-rest`, `-kong`, `-db`) |
| Restarts, crash loops, replicas | `K8sContainerSample`, `K8sDeploymentSample`, `K8sPodSample` |
| Alerts | `NrAiIssue`, policies "Pi cluster critical" and "Pi cluster warning" |
| Request latency, error rate | `Transaction` (APM; only after the app runs the New Relic agent) |

Read `references/log-schema.md` for fields and the noisy `[auth]` lines, and `references/nrql-cookbook.md` for ready queries.

## Rules

- Start broad (`--since "1 hours"`), then narrow by container, then grep. Compare against a quiet baseline before calling something an incident.
- `[auth]` proxy_check lines are 96% of app volume and are not errors. `--errors` already excludes them.
- An empty result for a quiet container is normal. Use `audit` to tell quiet from dropped before claiming logs are missing.
- Read-only by default. Creating or changing dashboards and alerts happens only through `observability/*.json` and `scripts/nr.ts apply`, and enabling an alert condition needs the owner's go-ahead.
- Logs reach New Relic from the moment the logging agent started; older lines are not recoverable. Use `kubectl logs` for the last few minutes or for a pod that just restarted.
