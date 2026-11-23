# Observability as code

`dashboard.json` and `alerts.json` are the source of truth for the "ai-listings" dashboard and the "ai-listings app" alert policy. `bun scripts/nr.ts apply` creates or updates them in New Relic account 8755228.

## Commands

```bash
bun scripts/nr.ts apply          # dry run: prints create, update or noop per resource, writes nothing
bun scripts/nr.ts apply --yes    # performs the writes
bun scripts/nr.ts backtest       # replays every condition over the last 7 days
bun scripts/nr.ts backtest --since "3 days"
```

`apply` matches resources by name, so a second run reports only `noop`. It never deletes. Removing an entry from the JSON leaves the resource in New Relic, and the dry run lists such leftovers as `orphan` rows (conditions in the policy that `alerts.json` no longer defines). Renaming a condition therefore leaves the old one behind as an orphan until someone removes it in New Relic. `apply` never touches the existing "Pi cluster critical" and "Pi cluster warning" policies.

| Resource | On a difference |
| --- | --- |
| Policy, conditions, channel, workflow, dashboard | Updated in place (`update`) |
| Email destination | Create only. A different address shows as `refused`, and `apply --yes` stops before any write |
| Channel bound to a different destination | `refused`, since a channel cannot be rebound |

`apply --yes` computes every step first and throws if any row is `refused`, so a plan that cannot finish writes nothing. The only notification address allowed is the owner's. `alerts.json` is validated with zod on load (dry run included), and any other address, a second destination, channel or workflow, an unknown key, a `thresholdDuration` that is not a multiple of `aggregationWindow`, a condition `nrql` containing FACET, SINCE or TIMESERIES, or a `historyQuery` that does not read the same event type or metric as the condition is rejected with the file and path of the bad field.

`apply` refuses a condition with `"enabled": true` unless its `historyQuery` shows at least 7 days of data. That is the only part of the enabling rules `apply` enforces. The zero breaches rule below is a process step.

The `historyQuery` guards against mistakes, not malicious edits. `observability/*.json` is executable config: `apply` turns it into live alerts and email, so reviewers must read changes to it like code, including `notifications.email`.

Entity search is eventually consistent. Running `apply --yes` again within a minute of creating the dashboard can fail to find it and create a duplicate. Wait a minute between runs.

## Conditions

All conditions are CRITICAL only, require every window of the duration to breach, and use incident preference PER_CONDITION. The email workflow "ai-listings app emails" sends to joeblackwaslike@gmail.com on ACTIVATED only, so nothing is sent on close, acknowledge or priority change. Its muting handling is `DONT_NOTIFY_FULLY_MUTED_ISSUES`, so a maintenance mute silences the email. Crash loops, missing replicas and node problems stay with the Pi cluster policies.

| Condition | Watches | Threshold and why | Enabled |
| --- | --- | --- | --- |
| App error rate | Real error lines from container `ai-listings` per minute (auth `proxy_check` and `proxy_redirect_to_login` excluded) | Above 5 per minute for 10 minutes. Baseline is about 20 per hour (p95 of 3 per minute, max 8 over 4 days), and a sustained 10 minutes never occurred | No |
| Log silence | Fewer than 1 log line per minute from `ai-listings` | Below 1 for 10 minutes, gaps count as 0. Median is 48 lines per minute | No |
| APM error rate | Count of failed transactions, 5 minute windows, gaps count as 0 | Above 5 for 10 minutes. Traffic is about 20 requests per 5 minutes, so a percentage with a 10 request minimum almost never had two qualifying windows in a row. An absolute count fires at that volume | No |
| APM p95 latency | p95 duration in seconds, 5 minute windows, 3 request minimum | Placeholder 30 seconds. `PUT /api/inngest` averages about 4 seconds, so set the real value from history | No |
| Inngest queue depth | `inngest_queue_depth` | Placeholder 100 for 15 minutes. It sits at 7 today | No |
| Inngest function failures | `inngest_function_run_ended_total` where status is not completed | Above 0 in one 15 minute window, so a burst of failures fires instead of needing a failure in every minute. Prometheus counters arrive as deltas, so use `sum()` | No |

The dashboard error shapes widget facets on the first 45 characters of error lines. Today those characters stop before any user id. Recheck the widget if the log format changes, because a longer prefix could put ids in the facet labels.

## Backtest

Output of `bun scripts/nr.ts backtest` on 2026-11-23:

```text
App error rate (enabled: false)
  insufficient history: 4d 1h 46m
  rule: ABOVE 5 for 600s in 60s windows
  data span tested: 4d 1h 46m (5866 windows)
  breaches: 0
  min 0 median 0 p95 3 max 8
Log silence (enabled: false)
  insufficient history: 4d 1h 46m
  rule: BELOW 1 for 600s in 60s windows
  data span tested: 4d 1h 46m (5866 windows)
  breaches: 0
  min 0 median 48 p95 69 max 235
APM error rate (enabled: false)
  insufficient history: 24m
  rule: ABOVE 5 for 600s in 300s windows
  data span tested: 24m (4 windows)
  breaches: 0
  min 0 median 0 p95 0 max 0
APM p95 latency (enabled: false)
  insufficient history: 24m
  rule: ABOVE 30 for 600s in 300s windows
  data span tested: 24m (4 windows)
  breaches: 0
  no data points
Inngest queue depth (enabled: false)
  insufficient history: 21m
  rule: ABOVE 100 for 900s in 60s windows
  data span tested: 21m (21 windows)
  breaches: 0
  min 7 median 7 p95 7 max 7
Inngest function failures (enabled: false)
  insufficient history: 19m
  rule: ABOVE 0 for 900s in 900s windows
  data span tested: 19m (1 windows)
  breaches: 0
  min 0 median 0 p95 0 max 0
```

None of the six conditions has 7 days of history, so all stay disabled. The two log conditions have 4 days and show zero breaches; they are the first to enable.

## Enabling a condition

Enable only with the owner's go-ahead, and only when all of these hold:

1. `bun scripts/nr.ts backtest` prints `history:` (not `insufficient history`) for the condition, meaning 7 days of data.
2. The same output shows `breaches: 0` over those 7 days. `apply` does not check this; it is a process step for whoever enables the condition.
3. For the APM latency, Inngest queue depth and Inngest failure conditions, the placeholder threshold was replaced with a value above the observed p95 and max of the series, then backtested again.

Then set `"enabled": true` in `alerts.json` and run `apply`, then `apply --yes`.
