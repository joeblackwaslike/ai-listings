# New Relic observability for ai-listings

## Context

New Relic is installed in the k3s cluster (`newrelic` namespace: logging daemonset on all 4 nodes, k8s-agents-operator, kube-state-metrics). Pod logs are now kept instead of lost. Three gaps remain:

1. **Log coverage is unverified.** `ai-listings` logs arrive (~3k/hr). Inngest, github-runner and most Supabase containers did not show in a top-20 facet.
2. **No APM.** Zero `Transaction` events. The operator's `newrelic-instrumentation` CR (nodejs, selector `instrument=true`) matches no pods. The app runs on **Bun** (`bun server.js`, Alpine/musl), which the New Relic Node agent doesn't reliably support.
3. **Agents have no way in.** Nothing in the repo mentions New Relic. Agents can't fetch logs, read dashboards or query errors.

Intended outcome: all app logs verifiably arriving, APM live, one dashboard plus a few monitors, and a repo skill + AGENTS.md pointer so any agent (Claude, Codex, Gemini) queries New Relic by default.

## Decisions (Joe's)

- Agent access = **repo skill + NRQL script** using the existing `NRAK-` user key (`NEW_RELIC_API_KEY`, `NEW_RELIC_ACCOUNT_ID` in `.env.production.local`). Official MCP server deferred.
- APM = **move the app from Bun to Node**, on a **glibc base image: `joeblackwaslike/debian:trixie`** (verified: amd64 + arm64, pushed 2026-11-23).

## My calls (flag if wrong)

- Builder stage moves to `node:22-trixie-slim` so pnpm installs glibc native packages (the Agent SDK picks `linux-arm64`, not `-musl`). Runner uses your Debian image with Node's binary copied from the same `node:22-trixie-slim` stage (same glibc).
- Operator injection first (label `instrument=true`). In-app `newrelic` npm agent only if injection yields no transactions.
- `dev`, `test`, `lint` scripts stay on Bun. Only `build`/`start` and the image move to Node.
- Alert emails go to `joeblackwaslike@gmail.com` through a new email destination and workflow. Existing destinations are PagerDuty and Mobile push (used by the two "Pi cluster" policies); I leave those alone.

## Out of scope

APM agents on Inngest, github-runner or Supabase (they get integrations instead, workstream D). New Relic MCP server. Structured-logging rewrite of `console.*` calls (revisit after the log audit shows what queries are painful).

## Workstreams

Branch from `origin/main` in `.worktrees/newrelic-observability` (current branch has unrelated WIP). Spec, plan and code in one PR; split into stacked PRs (A, then B, then C+D) if it passes ~400 hand-written lines. Order of work: A, B, D, C (C last because dashboards and alerts depend on APM and integration data).

### A. Agent tooling and log audit (no prod risk, ships first)

1. `scripts/nr.ts` (run as `bun scripts/nr.ts`), one file, NerdGraph over `fetch`:
   - `query "<NRQL>"` prints JSON.
   - `logs [--errors] [--ns ai-listings] [--since 1h] [--grep text]` canned Log queries.
   - `audit` compares 24h log facets (`namespace_name`, `container_name`) against `kubectl get deploy -A` workloads and prints missing ones.
   - `apply` idempotently creates/updates dashboards and alert conditions from `observability/*.json` (workstream C).
   - Reads key and account ID from env, falling back to `.env.production.local`. Never prints the key.
2. Run `audit`; for any workload missing from New Relic, find the cause (log path, Fluent Bit filter, pod excluded) and fix or report.
3. Skill `.claude/skills/newrelic-observability/SKILL.md` with `references/` (log schema and fields: `namespace_name`, `container_name`, `pod_name`, `message`; NRQL cookbook for errors, restarts, auth events; dashboards/alerts workflow). Description written to trigger on: "logs", "errors in prod", "pod crash", "is it down", "latency", "New Relic", "NRQL", "dashboard", "alert". Written via `superpowers:writing-skills` (pressure scenario before and after). Timeboxed look for an existing NR skill to reuse its NRQL reference.
4. AGENTS.md section "Production observability (New Relic)": when to reach for it (investigating prod errors, post-deploy verification, "why did X fail"), the one-line `bun scripts/nr.ts logs --errors --since 1h`, and a pointer to the skill. Edited via `agent-skills:agent-instructions`. Short, so Codex and Gemini get value without loading the skill.

### B. Node + glibc image, then APM

1. `deployment/Dockerfile`: builder `node:22-trixie-slim` (pnpm via npm, no bun copy); runner `FROM joeblackwaslike/debian:trixie`, `apt-get install libstdc++6 ca-certificates` as needed, copy `node` from the node stage, non-root user, `CMD ["node","server.js"]`. Replace the bun-based SDK import smoke check with `node --input-type=module -e "import('@anthropic-ai/claude-agent-sdk')..."`. Pin the Debian tag by digest or `sha-` tag, not `latest`.
2. `package.json`: `build` -> `next build`, `start` -> `next start`/standalone on Node.
3. `deployment/scripts/smoke-image.sh`: assert PID 1 is `node`, SDK imports, `ldd --version` is glibc. Run it locally on arm64.
4. App deployment (`deployment/kubernetes/app`): add pod-template label `instrument=true`. Redeploy through `deploy-app.sh` (2 replicas, rolling).
5. Verify: `Transaction` events with the app's name appear within ~5 min; Next route names look sane. If injection works but Next transactions are partial or empty, fall back to `newrelic` in-app agent (`src/instrumentation.ts`, `serverExternalPackages`, license key through the existing k8s secret flow in `deploy-app.sh`).
6. Rollback: revert label and previous image tag; image is built and pushed before the manifest changes.

### C. Dashboard and monitors (`observability/`, applied via `nr.ts apply`)

- **Dashboard "ai-listings"**, 2 pages. Logs/Errors: volume by container, error logs over time, recent errors table, auth-event counts. Runtime: pod restarts, CPU/memory per pod, replicas available vs desired, plus APM throughput, p95, error rate, slowest transactions once B lands.
- **Already covered, so not duplicated:** the existing "Pi cluster" policies (9 conditions) already alert on crash-looping pods (5 min), missing deployment replicas (15 min), failed jobs, node/volume/etcd problems. They go to PagerDuty and Mobile push. New conditions cover only what's missing.
- **New conditions** (new policy "ai-listings app", email workflow), CRITICAL only, no warning-level emails:
  1. App error rate: error log lines per minute on `namespace_name='ai-listings'` over a floor of real traffic, sustained 10 min.
  2. Log silence: no `ai-listings` logs for 10 min (ingestion or app down).
  3. APM error rate > 5% sustained 10 min with a minimum request count (after B).
  4. APM p95 latency over a threshold set from 7-day data, sustained 10 min (after B).
  5. Inngest: queue depth rising and not draining for 15 min; function failure ratio sustained (after D).
- **Anti-noise rules (apply to every condition):**
  - Threshold must hold for the whole window (`thresholdOccurrences ALL`, 5 to 15 min, longer than a rolling deploy takes), so a transient blip never opens an incident.
  - Incident preference `PER_CONDITION`, so one flapping pod or facet can't send several emails.
  - Email workflow notifies on **ACTIVATED only**: no email on close, acknowledge or priority change. Recovery is visible in New Relic issue history. A problem that recovers before the window ends never emails.
  - Minimum-volume guards on ratio conditions so one failed request at 3am can't read as "100% errors".
  - **Backtest before enabling:** run each condition's NRQL over the last 7 days, count how many times it would have fired, tune until normal days produce zero. Create conditions disabled, enable after the backtest passes.
- Check the `NRAK` key has alerts, dashboards and notifications permissions before writing.

### D. Integrations for Inngest, Supabase, github-runner (dashboards, no APM agents)

Existing data: `newrelic-prometheus-agent` is running (low data mode, annotation filter off), the infra agent already emits `K8s*Sample` events for all pods, and logs flow for these namespaces. Per workload:

- **Inngest:** the server exposes Prometheus `GET /metrics` on 8288 since v1.19.0, default gauge `inngest_queue_depth`; `INNGEST_EXPERIMENTAL_PROM_METRICS=1` adds per-function run and SDK request counters. Plan: check the running image version, set the env var in `deployment/kubernetes/inngest`, and get the Prometheus agent to scrape it (pod label/annotation or `extra_scrape_configs` in the `newrelic-bundle` HelmChart values). Dashboard page: queue depth, function runs/failures, plus pod CPU/memory and logs. Verify scrape annotation names against the agent's chart docs before editing.
- **Supabase:** New Relic's quickstart catalog has `supabase` and `postgresql` entries. Plan: read each `quickstart.yml`, install the one that works with a self-hosted stack (Postgres integration against `ai-listings-supabase-db`; Kong/PostgREST/GoTrue via k8s samples and logs). If it needs the hosted Supabase metrics API, use the Postgres integration plus the k8s/logs page instead.
- **github-runner:** catalog has `github` and `github-repo` quickstarts (Actions/repo activity). Plan: install the one that works with a self-hosted runner and our webhook/OTel options; the runner pod itself gets a k8s + logs dashboard page (restarts, CPU/memory, job log lines) and is covered by the existing crash-loop alert.
- Each integration lands as a page on the same "ai-listings" dashboard where possible, so there is one place to look. Anything that needs a Helm change to the cluster bundle is listed in the PR and applied by me through the HelmChart, not by hand.

## Verification

- `bun scripts/nr.ts audit` shows every expected workload present in 24h of logs (or an explained exception).
- `bun scripts/nr.ts logs --errors --since 1h` returns real ai-listings rows.
- `smoke-image.sh` green on arm64; `kubectl get pods -n ai-listings` 2/2 Ready after rollout; app login works.
- `SELECT count(*) FROM Transaction SINCE 10 minutes ago` > 0 after B.
- Dashboard and conditions found through NerdGraph entity/condition queries; force one test error log and confirm the error panel and condition see it.
- Each new condition's 7-day backtest shows zero firings on normal days; email workflow set to ACTIVATED only.
- `inngest_queue_depth` returns data in New Relic; Supabase DB and runner pages show live data.
- Fresh agent session, asked "any errors in prod in the last hour?", finds the AGENTS.md section, loads the skill and runs the script without prompting.

## Risks

- Next.js standalone under operator injection may yield incomplete transactions (fallback in B5).
- Runtime change Bun -> Node can surface behavior differences; smoke test plus a post-deploy check of login and one pipeline run.
- A user key has broad account rights; skill says writes only through `apply`, never print the key.
