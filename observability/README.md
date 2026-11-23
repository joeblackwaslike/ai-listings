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
| Policy, conditions, channel, workflow, dashboard | Updated in place (`update`). The workflow is rewritten whole, so a destination or filter added to it by hand in New Relic is removed on the next `apply --yes` |
| Email destination | Create only. A different address shows as `refused`, and `apply --yes` stops before any write |
| Channel bound to a different destination | `refused`, since a channel cannot be rebound |

`apply --yes` computes every step first and throws if any row is `refused`, so a plan that cannot finish writes nothing. The only notification address allowed is the owner's. `alerts.json` is validated with zod on load (dry run included), and any other address, a second destination, channel or workflow, an unknown key, a `thresholdDuration` that is not a multiple of `aggregationWindow`, a condition `nrql` containing FACET, SINCE or TIMESERIES, or a `historyQuery` that does not read the same event type or metric as the condition is rejected with the file and path of the bad field.

`apply` refuses a condition with `"enabled": true` unless its `historyQuery` shows at least 7 days of data. That is the only part of the enabling rules `apply` enforces. It is a coarse check on the age of the earliest event of that type: it does not test density or the condition's own filters, and neither does `backtest`, whose `history:` label uses the same earliest-event age. Continuity is a process step (rule 1 below). The zero breaches rule below is a process step.

The `historyQuery` guards against mistakes, not malicious edits. `observability/*.json` is executable config: `apply` turns it into live alerts and email, so reviewers must read changes to it like code, including `notifications.email`.

Entity search is eventually consistent. Running `apply --yes` again within a minute of creating the dashboard can fail to find it and create a duplicate. Wait a minute between runs.

## Conditions

All conditions are CRITICAL only, require every window of the duration to breach, and use incident preference PER_CONDITION. The email workflow "ai-listings app emails" sends to joeblackwaslike@gmail.com on ACTIVATED only, so nothing is sent on close, acknowledge or priority change. Its muting handling is `DONT_NOTIFY_FULLY_MUTED_ISSUES`, so a maintenance mute silences the email. Crash loops, missing replicas and node problems stay with the Pi cluster policies.

| Condition | Watches | Threshold and why | Enabled |
| --- | --- | --- | --- |
| App error rate | Real error lines from container `ai-listings` per minute (auth `proxy_check` and `proxy_redirect_to_login` excluded) | Above 5 per minute for 10 minutes. Baseline is about 20 per hour (p95 of 3 per minute, max 8 over 4 days), and a sustained 10 minutes never occurred | No |
| Log silence | No log line from `ai-listings` for 10 minutes, as loss of signal | Signal lost after 600 seconds with no data opens a violation (no gap filling). Median is 48 lines per minute | No |
| APM error rate | Count of failed transactions, 5 minute windows, gaps count as 0 | Above 5 for 10 minutes. Traffic is about 20 requests per 5 minutes, so a percentage with a 10 request minimum almost never had two qualifying windows in a row. An absolute count fires at that volume | No |
| APM p95 latency | p95 duration in seconds, 5 minute windows, 3 request minimum | Placeholder 30 seconds. `PUT /api/inngest` averages about 4 seconds, so set the real value from history | No |
| Inngest queue depth | `inngest_queue_depth` | Placeholder 100 for 15 minutes. It sits at 7 today | No |
| Inngest function failures | `inngest_function_run_ended_total` where status is not completed | Above 0 in one 15 minute window, so a burst of failures fires instead of needing a failure in every minute. Prometheus counters arrive as deltas, so use `sum()` | No |

The dashboard error shapes widget facets on the first 45 characters of error lines. Today those characters stop before any user id. Recheck the widget if the log format changes, because a longer prefix could put ids in the facet labels.

## Why log silence uses loss of signal

With the EVENT_FLOW aggregation method a window only closes when a later data point arrives. During total silence nothing arrives, so a static zero fill never advances and a Below 1 threshold never evaluates. New Relic also stops filling a gap once it is longer than the expiration duration. The Log silence condition therefore uses fill option NONE and sets `openViolationOnExpiration` to true with `expirationDuration` 600: the timer resets on every log line, and 600 seconds without one opens the violation. Loss of signal needs a signal to be present first, so it cannot fire for a condition enabled while the app is already silent. Windows that do arrive with a count of 0 still breach the Below 1 rule. The backtest counts a run of empty windows as long as the expiration as a breach.

## Backtest

Output of `bun scripts/nr.ts backtest` on 2026-11-23:

```text
App error rate (enabled: false)
  insufficient history: 4d 1h 57m
  rule: ABOVE 5 for 600s in 60s windows
  data span tested: 4d 1h 57m (5877 windows)
  breaches: 0
  min 0 median 0 p95 3 max 8
Log silence (enabled: false)
  insufficient history: 4d 1h 57m
  rule: BELOW 1 for 600s in 60s windows
  loss of signal: no data for 600s opens a violation
  data span tested: 4d 1h 57m (5877 windows)
  breaches: 0
  min 0 median 48 p95 69 max 235
APM error rate (enabled: false)
  insufficient history: 35m
  rule: ABOVE 5 for 600s in 300s windows
  data span tested: 35m (7 windows)
  breaches: 0
  min 0 median 0 p95 1 max 1
APM p95 latency (enabled: false)
  insufficient history: 35m
  rule: ABOVE 30 for 600s in 300s windows
  data span tested: 35m (7 windows)
  breaches: 0
  no data points
Inngest queue depth (enabled: false)
  insufficient history: 32m
  rule: ABOVE 100 for 900s in 60s windows
  data span tested: 32m (32 windows)
  breaches: 0
  min 7 median 7 p95 7 max 7
Inngest function failures (enabled: false)
  insufficient history: 30m
  rule: ABOVE 0 for 900s in 900s windows
  data span tested: 30m (2 windows)
  breaches: 0
  min 0 median 0 p95 0 max 0
```

None of the six conditions has 7 days of history, so all stay disabled. The two log conditions have 4 days and show zero breaches; they are the first to enable.

## Enabling a condition

Enable only with the owner's go-ahead, and only when all of these hold:

1. `bun scripts/nr.ts backtest` prints `history:` (not `insufficient history`) for the condition, meaning 7 days of data. Neither command checks that the data is continuous, so also confirm the printed window count is close to the span divided by the window size (7 days of 60 second windows is about 10,080), since missing windows are left out of the statistics.
2. The same output shows `breaches: 0` over those 7 days. `apply` does not check this; it is a process step for whoever enables the condition.
3. For the APM latency, Inngest queue depth and Inngest failure conditions, the placeholder threshold was replaced with a value above the observed p95 and max of the series, then backtested again.

Then set `"enabled": true` in `alerts.json` and run `apply`, then `apply --yes`.
