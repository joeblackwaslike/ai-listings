# New Relic Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verified log coverage, Node/glibc image with APM, an `nr` CLI plus skill so agents query New Relic, and a dashboard with low-noise alerts.

**Architecture:** Pure NRQL builders and an audit diff live in `src/lib/newrelic/` (tested with `bun test`); `scripts/nr.ts` is a thin CLI over NerdGraph `fetch`. Dashboards and alert conditions are JSON in `observability/`, applied idempotently by `nr.ts apply`. APM comes from the existing k8s-agents-operator (pod label `instrument=true`) once the image runs Node on glibc.

**Tech Stack:** TypeScript on Bun for scripts/tests, Next.js standalone on Node 22 in production, NerdGraph (`https://api.newrelic.com/graphql`), Docker buildx (arm64), kubectl.

**Spec:** `docs/superpowers/specs/2026-11-23-newrelic-observability-design.md`

## Global Constraints

- Account ID and key come from env `NEW_RELIC_ACCOUNT_ID`, `NEW_RELIC_API_KEY`, falling back to `.env.production.local`. The key is never printed, logged or committed.
- Production image: `FROM joeblackwaslike/debian:trixie` (amd64+arm64, glibc); Node 22 binary copied from `node:22-trixie-slim`; `CMD ["node","server.js"]`; pin the Debian base by digest.
- Builds target `linux/arm64` (cluster is Raspberry Pis).
- `dev`, `test`, `lint` scripts stay on Bun; only `build` and `start` move to Node.
- New alert conditions: CRITICAL only, `thresholdOccurrences ALL`, 5 to 15 min windows, incident preference `PER_CONDITION`, email workflow notifies on `ACTIVATED` only, created disabled and enabled only after a 7-day backtest shows zero spurious firings.
- Existing policies "Pi cluster critical/warning" (PagerDuty, Mobile push) are not modified; crash-loop, missing-replica and node conditions are not duplicated.
- Alert email destination: `joeblackwaslike@gmail.com`.
- No inline comments, banner comments, or commented-out code.
- Production-affecting steps (rollout, helm/k3s values, alert enable) run only in the tasks that name them.

## Review Focus

- `logs --errors` on a namespace with zero matches prints an empty result, not an error or crash.
- `audit` ignores completed Jobs/CronJob pods and `0/1` replica deployments (e.g. supabase-studio) without reporting false "missing logs".
- `nr.ts` run with no env and no `.env.production.local` fails with a one-line message naming the missing variable, never a stack trace containing a key.
- Ratio alert conditions return no data (not 100%) when request volume is below the floor.
- Image runs as non-root and the agent SDK imports under Node (ESM-only).

---

### Task 1: NRQL builders and audit diff (pure, tested)

**Files:**
- Create: `src/lib/newrelic/nrql.ts`
- Test: `src/lib/newrelic/nrql.test.ts`

**Interfaces:**
- Produces:
  - `logsQuery(opts: { namespace?: string; since?: string; grep?: string; errorsOnly?: boolean; limit?: number }): string` returns an NRQL `SELECT timestamp, namespace_name, container_name, pod_name, message FROM Log ...`. Defaults: `since="1 hour"`, `limit=50`. `errorsOnly` adds a case-insensitive match for `error|exception|fail|fatal` on `message`. `grep` and `namespace` values are escaped (single quotes doubled) before interpolation.
  - `auditDiff(expected: { namespace: string; name: string }[], seen: { namespace: string; container: string }[]): { missing: { namespace: string; name: string }[] }` where an expected workload counts as seen if any `seen` row has the same namespace and `container` equal to or prefixed by `name`.

- [ ] **Step 1: Write failing tests** in `nrql.test.ts`: `logsQuery({})` contains `FROM Log`, `SINCE 1 hour ago`, `LIMIT 50`; `logsQuery({namespace:"ai-listings",errorsOnly:true})` contains `namespace_name = 'ai-listings'` and an error pattern; `logsQuery({grep:"it's"})` contains `it''s` and no unescaped quote; `auditDiff` reports a workload with no matching row as missing and a workload matching by container prefix as seen; an empty `seen` marks every expected workload missing.
- [ ] **Step 2: Run** `bun test src/lib/newrelic/nrql.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** both functions in `nrql.ts`; escaping is a single `replaceAll("'", "''")` helper kept private to the file.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(newrelic): NRQL log query builders and audit diff`.

### Task 2: `nr` CLI (query, logs, audit)

**Files:**
- Create: `scripts/nr.ts`

**Interfaces:**
- Consumes: `logsQuery`, `auditDiff` from `@/lib/newrelic/nrql` (use the repo's existing path-alias or relative import, whichever other `scripts/*.ts` use).
- Produces: `bun scripts/nr.ts query "<NRQL>"`, `logs [--errors] [--ns <ns>] [--since "<n unit>"] [--grep <text>] [--limit <n>]`, `audit`. All print JSON to stdout, errors to stderr with exit 1. Internal `nrql(query: string): Promise<unknown[]>` posts the NerdGraph `actor.account(id).nrql(query)` query and throws on `errors`.

- [ ] **Step 1: Implement** env loading (process env first, else parse `NEW_RELIC_*` lines from `.env.production.local` at repo root; missing var -> `error: NEW_RELIC_API_KEY not set` and exit 1), `nrql()`, and the three subcommands. `audit` gets expected workloads from `kubectl get deploy -A -o json` (spec.replicas > 0 only) and seen rows from `SELECT count(*) FROM Log SINCE 24 hours ago FACET namespace_name, container_name LIMIT MAX`, then prints `auditDiff` output.
- [ ] **Step 2: Verify** `bun scripts/nr.ts logs --errors --since "1 hour" --limit 5` exits 0 and prints a JSON array; `bun scripts/nr.ts query "SELECT count(*) FROM Log SINCE 1 hour ago"` returns a count > 0; running with `NEW_RELIC_API_KEY= ` and the env file hidden prints the one-line error and exits 1.
- [ ] **Step 3: Commit** `feat(newrelic): nr CLI for NRQL, logs and coverage audit`.

### Task 3: Log coverage audit and fixes

**Files:** none planned; modify only the config the audit proves wrong.

- [ ] **Step 1: Run** `bun scripts/nr.ts audit`. Record the missing workloads.
- [ ] **Step 2: For each missing workload,** find the cause (`kubectl get pod -o yaml` annotation `fluentbit.io/exclude`, log written to a file not stdout, container name mismatch in the diff) and fix it (annotation removal in the repo's manifest, or report as a cluster-level fix with the exact HelmChart value). Re-run `audit`.
- [ ] **Step 3: Verify** `audit` returns `missing: []`, or each remaining entry has a one-line reason recorded in `docs/superpowers/specs/2026-11-23-newrelic-observability-design.md` under a new "Audit results" heading.
- [ ] **Step 4: Commit** `fix(observability): close log coverage gaps` (only if files changed).

### Task 4: Agent skill and AGENTS.md section

**Files:**
- Create: `.claude/skills/newrelic-observability/SKILL.md`, `.claude/skills/newrelic-observability/references/nrql-cookbook.md`, `.claude/skills/newrelic-observability/references/log-schema.md`
- Modify: `AGENTS.md` (new section "Production observability (New Relic)")

**Interfaces:**
- Consumes: the `scripts/nr.ts` subcommands from Task 2 and the `apply` command from Task 9.

- [ ] **Step 1: RED.** Load `superpowers:writing-skills`. Run a fresh subagent with no skill on: "Any errors in prod ai-listings in the last hour?" and record how it fails to find or use New Relic.
- [ ] **Step 2: Write the skill.** Frontmatter `description` states when to use it (investigating prod errors, post-deploy verification, pod crashes, latency, dashboards, alerts, New Relic, NRQL). Body: the `nr.ts` commands, log fields available (`namespace_name`, `container_name`, `pod_name`, `stream`, `message`, `timestamp`; note Fluent Bit allowlist drops other attributes and logs are plain strings, with `[auth] {json}` lines parseable with `message LIKE`), 10 NRQL recipes (errors by container, restarts, auth failures, Inngest function failures, APM p95), the dashboard/alert workflow (`observability/*.json` then `apply`), and rules (never print the key, writes only via `apply`, ask before enabling alerts).
- [ ] **Step 3: AGENTS.md section** via `agent-skills:agent-instructions`: 6 lines max, when to use New Relic, the one-line `bun scripts/nr.ts logs --errors --since "1 hour"`, and a pointer to the skill path.
- [ ] **Step 4: GREEN.** Fresh subagent with the repo's AGENTS.md, same question. Expected: it finds the AGENTS.md section, runs `nr.ts logs --errors`, reports real rows. Iterate wording until it does.
- [ ] **Step 5: Commit** `docs(agents): New Relic skill and AGENTS.md section`.

### Task 5: Node + glibc image

**Files:**
- Modify: `deployment/Dockerfile`, `package.json` (scripts `build`, `start`), `deployment/scripts/smoke-image.sh`

**Interfaces:**
- Produces: an image whose PID 1 is `node server.js`, glibc, non-root uid 1001, that serves `/login` 200.

- [ ] **Step 1: Dockerfile.** Builder stage `node:22-trixie-slim` with pnpm installed via npm (version from the existing `PNPM_VERSION` arg), no bun copy. Runner `FROM joeblackwaslike/debian:trixie@sha256:<digest of the trixie tag from docker buildx imagetools inspect>`; `apt-get install -y --no-install-recommends libstdc++6 ca-certificates` and `apt-get clean`; `COPY --from=node` the node binary to `/usr/local/bin/node`; keep the existing standalone/static/public/agent-sdk copies and the 1001 user; `CMD ["node","server.js"]`. Replace the bun smoke `RUN` with `RUN node --input-type=module -e "import('@anthropic-ai/claude-agent-sdk').then(()=>console.log('claude-agent-sdk: OK')).catch(e=>{console.error(e);process.exit(1)})"`. Remove the now-false "match the production runtime" Bun comments.
- [ ] **Step 2: package.json:** `"build": "next build"`, `"start": "next start"`.
- [ ] **Step 3: smoke-image.sh:** PID 1 check expects `^node `, SDK check uses `node --input-type=module -e`, add `docker exec "$name" sh -c 'ldd --version 2>&1 | head -1' | grep -qi glibc || grep -qi 'GNU libc'`-style check named "glibc runtime", and assert `id -u` is 1001. Update the remaining bun invocations in the file the same way.
- [ ] **Step 4: Verify.** `deployment/scripts/build.sh` (arm64) then `deployment/scripts/smoke-image.sh <image>`. Expected: all `ok` lines, exit 0.
- [ ] **Step 5: Commit** `feat(deploy): run on Node 22 on glibc (joeblackwaslike/debian:trixie)`.

### Task 6: Roll out and enable APM

**Files:**
- Modify: `deployment/kubernetes/app/deployment.yaml` (pod template labels: add `instrument: "true"`)

- [ ] **Step 1: Push the image** the way `build.sh` already does, then `deployment/scripts/deploy-app.sh`. Add the label in the same rollout.
- [ ] **Step 2: Verify rollout:** `kubectl rollout status deploy/ai-listings -n ai-listings` finishes; both pods `1/1`; `/login` 200 through the ingress; one authenticated page loads.
- [ ] **Step 3: Verify APM:** `bun scripts/nr.ts query "SELECT count(*), uniques(appName) FROM Transaction SINCE 10 minutes ago"` returns count > 0 after generating a few requests. If 0 after 10 min or transactions lack route names, add the in-app `newrelic` package (`src/instrumentation.ts`, `serverExternalPackages: ['newrelic']`, license key via the secret flow in `deploy-app.sh` plus its REQUIRED list), rebuild, redeploy, re-verify.
- [ ] **Step 4: Rollback path** if login or the pipeline breaks: `kubectl rollout undo deploy/ai-listings -n ai-listings`.
- [ ] **Step 5: Commit** `feat(deploy): label app pods for New Relic auto-instrumentation`.

### Task 7: Inngest metrics

**Files:**
- Modify: `deployment/kubernetes/inngest/deployment.yaml`; cluster `newrelic-bundle` HelmChart values only if the agent needs `extra_scrape_configs`.

- [ ] **Step 1: Check the version:** the running `ghcr.io/joeblackwaslike/inngest` reports >= v1.19.0 (`kubectl logs` banner or the image labels). If older, stop and report.
- [ ] **Step 2: Add** env `INNGEST_EXPERIMENTAL_PROM_METRICS=1` and the scrape label/annotation the `newrelic-prometheus-agent` chart documents (verify the exact keys in the chart's `values.yaml` before writing). Apply with `deploy-inngest.sh`.
- [ ] **Step 3: Verify:** `bun scripts/nr.ts query "SELECT latest(inngest_queue_depth) FROM Metric SINCE 10 minutes ago"` returns a row.
- [ ] **Step 4: Commit** `feat(inngest): expose Prometheus metrics to New Relic`.

### Task 8: Supabase and runner integrations

**Files:**
- Create: `observability/integrations.md` (what was installed, data source, how to verify)

- [ ] **Step 1: Read** `quickstarts/supabase`, `quickstarts/postgresql`, `quickstarts/github`, `quickstarts/github-repo` in `newrelic/newrelic-quickstarts` via `gh api`; for each, record what data source it needs.
- [ ] **Step 2: Install** what works with self-hosted: Postgres integration against `ai-listings-supabase-db` (credentials from existing secrets, read-only monitoring role), the GitHub quickstart if its data source is available. Anything that fails the self-hosted fit is noted with the reason in `integrations.md`; k8s samples and logs cover that workload on the dashboard.
- [ ] **Step 3: Verify** each installed integration produces data via `nr.ts query` (event or metric type named in `integrations.md`).
- [ ] **Step 4: Commit** `feat(observability): Supabase and GitHub integrations`.

### Task 9: Dashboard, alerts, backtest, apply

**Files:**
- Create: `observability/dashboard.json`, `observability/alerts.json`, `observability/README.md`; extend `scripts/nr.ts` with `apply` and `backtest`

**Interfaces:**
- Produces: `nr.ts apply` (idempotent, matches by name: dashboard "ai-listings", policy "ai-listings app", conditions by name, email destination and workflow), `nr.ts backtest` (for each condition in `alerts.json` runs its NRQL with `SINCE 7 days ago TIMESERIES` and prints how many windows would have breached for the full threshold duration).

- [ ] **Step 1: Dashboard JSON** with two pages: Logs/Errors and Runtime/APM (+ Inngest, Supabase, runner panels from Tasks 7 and 8).
- [ ] **Step 2: alerts.json** with the five new conditions from the spec, each carrying NRQL, threshold, duration, aggregation window 60s `EVENT_FLOW`, a minimum-volume guard where it is a ratio, and `enabled: false`.
- [ ] **Step 3: Implement** `apply` and `backtest` in `scripts/nr.ts` (NerdGraph `dashboardCreate/Update`, `alertsPolicyCreate`, `alertsNrqlConditionStaticCreate/Update`, notifications destination and workflow with `notificationTriggers: [ACTIVATED]`).
- [ ] **Step 4: Run** `nr.ts backtest`; tune thresholds until normal days show zero breaches; record the numbers in `observability/README.md`.
- [ ] **Step 5: Run** `nr.ts apply`, then re-run it. Expected: second run reports no changes.
- [ ] **Step 6: Enable** the conditions only after Step 4 is clean (`enabled: true`, `apply` again). Force one test error log line and confirm the Logs/Errors panel shows it without an email being sent.
- [ ] **Step 7: Commit** `feat(observability): dashboard, low-noise alerts, apply and backtest`.
