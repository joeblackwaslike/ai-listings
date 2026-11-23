# Integrations evaluated

Checked against `newrelic/newrelic-quickstarts` on 2026-11-23. No catalog quickstart is installed. Everything is covered by Kubernetes samples and logs on the "ai-listings" dashboard.

| Quickstart | What it needs | Decision |
| --- | --- | --- |
| `supabase` | It is a LangChain vector-search monitor, not a Supabase platform monitor | Not applicable |
| `github` | Dependabot events | Not useful here; the runner is monitored through its pod |
| `github-repo` | A GitHub repository webhook whose URL carries a New Relic ingest key | Owner decision: the key would sit in an outward-facing webhook URL |
| `postgresql` | The New Relic Postgres on-host integration, a DB monitoring role, and a change to the cluster `newrelic-bundle` Helm values | Owner decision: needs a database role and a cluster change |

## What covers each workload instead

| Workload | Source | Dashboard page |
| --- | --- | --- |
| ai-listings | APM (`Transaction`), `Log`, `K8s*Sample` | Logs and errors, Runtime and APM |
| Inngest | Prometheus metrics (`Metric`), `K8s*Sample`, `Log` | Inngest |
| Supabase | `Log` per container, `K8s*Sample` | Supabase and runner |
| github-runner | `K8s*Sample`, `Log` | Supabase and runner |

Inngest metrics are scraped by the `newrelic-prometheus-agent` through the pod annotations `prometheus.io/scrape`, `prometheus.io/port=8288` and `prometheus.io/path=/metrics`. Counters such as `inngest_function_run_ended_total` arrive as deltas, so query them with `sum()` and `TIMESERIES`; `rate()` and `derivative()` return null.
