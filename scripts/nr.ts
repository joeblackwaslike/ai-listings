import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { envFileNeeded, parseEnvFile, resolveCredentials } from '@/lib/newrelic/env'
import { type ConditionFile, MIN_HISTORY_SECONDS } from '@/lib/newrelic/alerts'
import { type Row, applyPlan, buildPlan } from '@/lib/newrelic/apply'
import { parseAlertsFile, parseDashboardFile } from '@/lib/newrelic/config'
import type { PlanRow } from '@/lib/newrelic/plan'
import {
  breachEpisodes,
  chunkWindows,
  formatSpan,
  seriesQuery,
  seriesStats,
  seriesValue,
  windowSeconds,
} from '@/lib/newrelic/backtest'
import { parseGraphqlData, parseMutationResult, parseNerdGraphResponse } from '@/lib/newrelic/nerdgraph'
import { auditDiff, logsQuery, truncateMessages } from '@/lib/newrelic/nrql'
import {
  classifyMissing,
  expectedFromK8s,
  kubectlDuration,
  seenFromFacets,
  sumPodCounts,
} from '@/lib/newrelic/workloads'

const ENDPOINT = 'https://api.newrelic.com/graphql'
const GRAPHQL = 'query($a:Int!,$q:Nrql!){actor{account(id:$a){nrql(query:$q){results}}}}'
const MESSAGE_MAX = 300
const FACET_ROW_CAP = 5000
const USAGE = `usage:
  bun scripts/nr.ts query "<NRQL>"
  bun scripts/nr.ts logs [--errors] [--ns <namespace>] [--since "<n> hours"] [--grep <text>] [--limit <n>] [--full]
  bun scripts/nr.ts audit [--since "<n> hours"]
  bun scripts/nr.ts apply [--yes]
  bun scripts/nr.ts backtest [--since "<n> days"]`

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function envFileCandidates(): string[] {
  try {
    const worktreeRoot = git(['rev-parse', '--show-toplevel'])
    const mainRoot = join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), '..')
    return [join(worktreeRoot, '.env.production.local'), join(mainRoot, '.env.production.local')]
  } catch {
    return []
  }
}

function loadEnvFile(): Record<string, string> {
  if (!envFileNeeded(process.env)) return {}
  const path = envFileCandidates().find(existsSync)
  return path ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

let cachedCredentials: ReturnType<typeof resolveCredentials> | undefined

function credentials() {
  cachedCredentials ??= resolveCredentials(process.env, loadEnvFile())
  return cachedCredentials
}

async function send(query: string, variables: Record<string, unknown>) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Key': credentials().apiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  const body: unknown = await response.json().catch(() => null)
  return { status: response.status, body }
}

async function nrql(query: string): Promise<unknown[]> {
  const { status, body } = await send(GRAPHQL, { a: credentials().accountId, q: query })
  return parseNerdGraphResponse(status, body)
}

async function graphql(query: string, variables: Record<string, unknown> = {}) {
  const { status, body } = await send(query, { a: credentials().accountId, ...variables })
  return parseGraphqlData(status, body)
}

async function mutate(field: string, query: string, variables: Record<string, unknown>) {
  const { status, body } = await send(query, { a: credentials().accountId, ...variables })
  return parseMutationResult(status, body, field)
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function runLogs(argv: string[]): Promise<unknown[]> {
  const { values } = parseArgs({
    args: argv,
    options: {
      errors: { type: 'boolean' },
      ns: { type: 'string' },
      since: { type: 'string' },
      grep: { type: 'string' },
      limit: { type: 'string' },
      full: { type: 'boolean' },
    },
  })
  const query = logsQuery({
    namespace: values.ns,
    since: values.since,
    grep: values.grep,
    errorsOnly: values.errors,
    limit: values.limit === undefined ? undefined : Number(values.limit),
  })
  const rows = (await nrql(query)) as object[]
  return values.full ? rows : truncateMessages(rows, MESSAGE_MAX)
}

function kubectl(args: string[]): string {
  return execFileSync('kubectl', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

interface Pod {
  metadata: { name: string }
  spec: { containers: { name: string }[] }
  status?: { phase?: string }
}

interface ContainerLineCount {
  namespace: string
  name: string
  lines?: number
  pods?: number
  error?: string
}

function firstLine(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr
  const reason = (stderr || (error instanceof Error ? error.message : String(error))).trim()
  return reason.split('\n')[0]
}

function countContainerLines(
  namespace: string,
  name: string,
  duration: string,
  podsByNamespace: Map<string, Pod[]>,
): ContainerLineCount {
  try {
    if (!podsByNamespace.has(namespace)) {
      const list = JSON.parse(kubectl(['get', 'pods', '-n', namespace, '-o', 'json'])) as { items: Pod[] }
      podsByNamespace.set(namespace, list.items)
    }
    const pods = (podsByNamespace.get(namespace) ?? []).filter(
      (pod) => pod.status?.phase === 'Running' && pod.spec.containers.some((c) => c.name === name),
    )
    const results = pods.map((pod) => {
      try {
        const output = kubectl(['logs', '-n', namespace, pod.metadata.name, '-c', name, `--since=${duration}`])
        return { lines: output === '' ? 0 : output.trimEnd().split('\n').length }
      } catch (error) {
        return { error: firstLine(error) }
      }
    })
    return { namespace, name, ...sumPodCounts(results) }
  } catch (error) {
    return { namespace, name, error: firstLine(error) }
  }
}

async function runAudit(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string' } } })
  const window = values.since ?? '6 hours'
  const duration = kubectlDuration(window)
  let kube: string
  try {
    kube = kubectl(['get', 'deploy,statefulset', '-A', '-o', 'json'])
  } catch (error) {
    throw new Error(`kubectl failed: ${firstLine(error)}`)
  }
  const expected = expectedFromK8s(JSON.parse(kube))
  const rows = (await nrql(
    `SELECT count(*) FROM Log SINCE ${window} ago FACET namespace_name, container_name LIMIT MAX`,
  )) as { facet: (string | null)[] }[]
  if (rows.length >= FACET_ROW_CAP) {
    console.error(`warning: facet query returned ${rows.length} rows; coverage may be truncated`)
  }
  const { missing } = auditDiff(expected, seenFromFacets(rows))
  const podsByNamespace = new Map<string, Pod[]>()
  const counts = missing.map(({ namespace, name }) =>
    countContainerLines(namespace, name, duration, podsByNamespace),
  )
  return { window, missing, ...classifyMissing(missing, counts) }
}

function readObservability<T>(name: string, parse: (raw: unknown) => T): T {
  const root = git(['rev-parse', '--show-toplevel'])
  return parse(JSON.parse(readFileSync(join(root, 'observability', name), 'utf8')))
}

async function historySeconds(historyQuery: string): Promise<number | null> {
  const [row] = (await nrql(historyQuery)) as Row[]
  const earliest = row?.['earliest.timestamp']
  return typeof earliest === 'number' ? Math.round((Date.now() - earliest) / 1000) : null
}

function printRow(row: PlanRow, suffix = ''): void {
  console.log(`${row.kind.padEnd(12)} ${row.action.padEnd(7)} ${row.name}${suffix}`)
}

async function runApply(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { yes: { type: 'boolean' } } })
  const dashboard = readObservability('dashboard.json', parseDashboardFile)
  const alerts = readObservability('alerts.json', parseAlertsFile)
  const plan = await buildPlan(
    { accountId: credentials().accountId, graphql, mutate, nrql },
    alerts,
    dashboard,
  )
  for (const { row } of plan.steps) printRow(row)
  for (const row of plan.orphans) printRow(row)
  if (!values.yes) return console.log('dry run: nothing written (use --yes to apply)')
  await applyPlan(plan, (row, id) => printRow(row, ` ${id}`))
}

const BACKTEST_CONCURRENCY = 4
const MAX_BUCKETS = 360

async function conditionSeries(condition: ConditionFile, start: number, end: number) {
  const windows = chunkWindows(start, end, condition.aggregationWindow, MAX_BUCKETS)
  const chunks: Row[][] = []
  for (let i = 0; i < windows.length; i += BACKTEST_CONCURRENCY) {
    const batch = windows.slice(i, i + BACKTEST_CONCURRENCY)
    chunks.push(
      ...(await Promise.all(
        batch.map(([from, to]) =>
          nrql(seriesQuery(condition.nrql, from, to, condition.aggregationWindow)) as Promise<Row[]>,
        ),
      )),
    )
  }
  return chunks.flat().sort((a, b) => a.beginTimeSeconds - b.beginTimeSeconds).map(seriesValue)
}

async function runBacktest(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string' } } })
  const window = windowSeconds(values.since ?? '7 days')
  const alerts = readObservability('alerts.json', parseAlertsFile)
  const now = Math.floor(Date.now() / 1000)
  for (const condition of alerts.conditions) {
    const span = await historySeconds(condition.historyQuery)
    const start = now - Math.min(window, span ?? 0)
    console.log(`${condition.name} (enabled: ${condition.enabled})`)
    console.log(
      span !== null && span >= MIN_HISTORY_SECONDS
        ? `  history: ${formatSpan(span)}`
        : `  insufficient history: ${span === null ? 'none' : formatSpan(span)}`,
    )
    if (span === null) continue
    const series = await conditionSeries(condition, start, now)
    const breaches = breachEpisodes(series, {
      operator: condition.operator,
      threshold: condition.threshold,
      requiredPoints: condition.thresholdDuration / condition.aggregationWindow,
      fill: condition.fillOption === 'STATIC' ? (condition.fillValue ?? 0) : null,
      expirationPoints: condition.openViolationOnExpiration
        ? condition.expirationDuration / condition.aggregationWindow
        : undefined,
    })
    const stats = seriesStats(series)
    console.log(`  rule: ${condition.operator} ${condition.threshold} for ${condition.thresholdDuration}s in ${condition.aggregationWindow}s windows`)
    if (condition.openViolationOnExpiration) console.log(`  loss of signal: no data for ${condition.expirationDuration}s opens a violation`)
    console.log(`  data span tested: ${formatSpan(now - start)} (${series.length} windows)`)
    console.log(`  breaches: ${breaches}`)
    console.log(stats ? `  min ${stats.min} median ${stats.median} p95 ${stats.p95} max ${stats.max}` : '  no data points')
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'query' && rest.length === 1) return print(await nrql(rest[0]))
  if (command === 'logs') return print(await runLogs(rest))
  if (command === 'audit') return print(await runAudit(rest))
  if (command === 'apply') return runApply(rest)
  if (command === 'backtest') return runBacktest(rest)
  console.error(USAGE)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) console.error(USAGE)
  process.exit(1)
})
