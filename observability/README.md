# Observability as code

`dashboard.json` and `alerts.json` are the source of truth for the "ai-listings" dashboard and the "ai-listings app" alert policy. `bun scripts/nr.ts apply` creates or updates them in New Relic account 8755228.

## Commands

```bash
bun scripts/nr.ts apply          # dry run: prints create, update or noop per resource, writes nothing
bun scripts/nr.ts apply --yes    # performs the writes
bun scripts/nr.ts backtest       # replays every condition over the last 7 days
bun scripts/nr.ts backtest --since "3 days"
```

`apply` matches resources by name, so a second run reports only `noop`. It never deletes: removing an entry from the JSON leaves the resource in New Relic, and the existing "Pi cluster critical" and "Pi cluster warning" policies are never touched. An update to the email destination, channel or workflow is reported but refused; change those in New Relic.

`apply` refuses a condition with `"enabled": true` unless its `historyQuery` shows at least 7 days of data.

## Conditions

All conditions are CRITICAL only, require every window of the duration to breach, and use incident preference PER_CONDITION. The email workflow "ai-listings app emails" sends to joeblackwaslike@gmail.com on ACTIVATED only, so nothing is sent on close, acknowledge or priority change. Crash loops, missing replicas and node problems stay with the Pi cluster policies.

| Condition | Watches | Threshold and why | Enabled |
| --- | --- | --- | --- |
| App error rate | Real error lines from container `ai-listings` per minute (auth `proxy_check` and `proxy_redirect_to_login` excluded) | Above 5 per minute for 10 minutes. Baseline is about 20 per hour (p95 of 3 per minute, max 8 over 4 days), and a sustained 10 minutes never occurred | No |
| Log silence | Fewer than 1 log line per minute from `ai-listings` | Below 1 for 10 minutes, gaps count as 0. Median is 48 lines per minute | No |
| APM error rate | Failed transactions as a percent, 5 minute windows | Above 5 percent for 10 minutes. Returns no data under 10 requests per window | No |
| APM p95 latency | p95 duration in seconds, 5 minute windows, 10 request minimum | Placeholder 30 seconds. `PUT /api/inngest` averages about 4 seconds, so set the real value from history | No |
| Inngest queue depth | `inngest_queue_depth` | Placeholder 100 for 15 minutes. It sits at 7 today | No |
| Inngest function failures | `inngest_function_run_ended_total` where status is not completed | Placeholder above 0 per minute for 15 minutes; Prometheus counters arrive as deltas, so use `sum()` | No |

## Backtest

Output of `bun scripts/nr.ts backtest` on 2026-11-23:

```text
App error rate (enabled: false)
  insufficient history: 4d 1h 37m
  rule: ABOVE 5 for 600s in 60s windows
  data span tested: 4d 1h 37m (5857 windows)
  breaches: 0
  min 0 median 0 p95 3 max 8
Log silence (enabled: false)
  insufficient history: 4d 1h 37m
  rule: BELOW 1 for 600s in 60s windows
  data span tested: 4d 1h 37m (5857 windows)
  breaches: 0
  min 0 median 48 p95 69 max 235
APM error rate (enabled: false)
  insufficient history: 15m
  rule: ABOVE 5 for 600s in 300s windows
  data span tested: 15m (3 windows)
  breaches: 0
  no data points
APM p95 latency (enabled: false)
  insufficient history: 15m
  rule: ABOVE 30 for 600s in 300s windows
  data span tested: 15m (3 windows)
  breaches: 0
  no data points
Inngest queue depth (enabled: false)
  insufficient history: 12m
  rule: ABOVE 100 for 900s in 60s windows
  data span tested: 12m (12 windows)
  breaches: 0
  min 7 median 7 p95 7 max 7
Inngest function failures (enabled: false)
  insufficient history: none
```

None of the six conditions has 7 days of history, so all are created disabled. The two log conditions have 4 days and show zero breaches; they are the first to enable.

## Enabling a condition

Enable only with the owner's go-ahead, and only when all of these hold:

1. `bun scripts/nr.ts backtest` prints `history:` (not `insufficient history`) for the condition, meaning 7 days of data.
2. The same output shows `breaches: 0` over those 7 days.
3. For the APM latency, Inngest queue depth and Inngest failure conditions, the placeholder threshold was replaced with a value above the observed p95 and max of the series, then backtested again.

Then set `"enabled": true` in `alerts.json` and run `apply`, then `apply --yes`.
