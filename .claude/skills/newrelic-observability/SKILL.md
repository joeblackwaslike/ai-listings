---
name: newrelic-observability
description: Use when investigating production behavior of ai-listings: prod errors, "is it down", pod crashes or restarts, why a sync or pipeline step failed, post-deploy verification, checking dashboards or alerts, or any mention of New Relic or NRQL. Production pod logs, Kubernetes state and alerts all live in New Relic; use it before raw kubectl logs.
---

# New Relic for ai-listings

Every pod log in the cluster, Kubernetes state (restarts, replicas) and the alert policies are in New Relic. Query it with `scripts/nr.ts` instead of `kubectl logs` for anything older than a few minutes or spanning pods.

## Commands (run from the repo root)

```bash
bun scripts/nr.ts logs --errors --ns ai-listings --since "1 hour"   # real errors only
bun scripts/nr.ts logs --ns sup-ai-listings --grep "relation" --since "6 hours" --limit 20
bun scripts/nr.ts query "SELECT count(*) FROM Log SINCE 1 hour ago FACET container_name"
bun scripts/nr.ts audit --since "6 hours"                     # which workloads have logs; quiet vs dropped
bun scripts/nr.ts backtest [--since "7 days"]                 # replay alert conditions from observability/alerts.json
bun scripts/nr.ts apply [--yes]                               # dry run by default; --yes writes
```

Flags: `--since "<n> minutes|hours|days"` with n 1 to 9999, `--limit` 1 to 2000 (default 50), `--grep` is a case-sensitive LIKE match, `audit` needs kubectl access.

Output is JSON. Pipe through `jq -c` and print only the fields you need. Messages are truncated to 300 characters by default; `--full` prints whole messages. Log lines can contain user IDs and tokens, so show counts, patterns and short excerpts, never whole dumps.

Credentials come from `NEW_RELIC_API_KEY` and `NEW_RELIC_ACCOUNT_ID` in the environment or `.env.production.local`. Never print, log or commit the key.

## Where things are

| Question | Look at |
| --- | --- |
| App errors | `Log` where `namespace_name='ai-listings'` and `container_name='ai-listings'` |
| Background jobs | Lines starting `[sync-platform-...]` and `[ebay]` are in container `ai-listings`. Inngest server logs are container `inngest` |
| Supabase | `Log` where `namespace_name='sup-ai-listings'` (e.g. `supabase-auth`, `-rest`, `-kong`, `-db`) |
| Restarts, crash loops, replicas | `K8sContainerSample`, `K8sDeploymentSample`, `K8sPodSample` |
| Alerts | `NrAiIssue`. Policies are "Pi cluster critical" and "Pi cluster warning", but `policyName` and `conditionName` are not populated on issues; the condition name is inside `title` |
| Request latency, error rate | `Transaction` (APM). Returns nothing until the app runs the New Relic agent; an empty result means no agent, not no traffic |

Read `references/log-schema.md` for fields and the noisy `[auth]` lines, and `references/nrql-cookbook.md` for ready queries.

## Rules

- Start broad (`--since "1 hour"`), then narrow by container, then grep. Compare against a quiet baseline before calling something an incident.
- The auth `proxy_check` and `proxy_redirect_to_login` diagnostics are most of the app volume and are not errors. `--errors` and the cookbook error recipes exclude exactly those two events, so real auth failures such as `proxy_unexpected_error` still show.
- An empty result for a quiet container is normal. Use `audit` to tell quiet from dropped before claiming logs are missing.
- The dry run (`apply`) is always allowed.
- Never run `apply --yes` without the owner's explicit go-ahead in this session.
- Edits to `observability/*.json` need the same review, because `apply` makes them live. That includes `notifications.email`, which must stay the owner's address.
- Never enable a condition without the owner's go-ahead.
- `apply` never deletes. Writes go only through `apply`; never send other NerdGraph mutations.
- `apply` enforces the 7 day history length for enabled conditions. The zero breaches rule from `backtest` is a process step, not checked by `apply`.
- The API key is a full rights user key, so this restraint is by convention, not enforced.
- Lines logged before the logging agent was installed are not in New Relic. Use `kubectl logs` for the last few minutes or for a pod that just restarted.
