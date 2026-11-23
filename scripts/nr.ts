import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { envFileNeeded, parseEnvFile, resolveCredentials } from '@/lib/newrelic/env'
import {
  type AlertsFile,
  type ConditionFile,
  MIN_HISTORY_SECONDS,
  assertEnableAllowed,
  channelInput,
  conditionInput,
  conditionSpec,
  destinationEmail,
  destinationInput,
  workflowInput,
} from '@/lib/newrelic/alerts'
import {
  breachEpisodes,
  chunkWindows,
  formatSpan,
  seriesQuery,
  seriesStats,
  seriesValue,
  windowSeconds,
} from '@/lib/newrelic/backtest'
import { type DashboardFile, dashboardInput, dashboardSpec } from '@/lib/newrelic/dashboard'
import { parseGraphqlData, parseMutationResult, parseNerdGraphResponse } from '@/lib/newrelic/nerdgraph'
import { type ExistingResource, type PlanRow, planChanges } from '@/lib/newrelic/plan'
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

function credentials() {
  return resolveCredentials(process.env, loadEnvFile())
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

function readObservability<T>(name: string): T {
  const root = git(['rev-parse', '--show-toplevel'])
  return JSON.parse(readFileSync(join(root, 'observability', name), 'utf8')) as T
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

async function historySeconds(historyQuery: string): Promise<number | null> {
  const [row] = (await nrql(historyQuery)) as Row[]
  const earliest = row?.['earliest.timestamp']
  return typeof earliest === 'number' ? Math.round((Date.now() - earliest) / 1000) : null
}

const CONDITION_FIELDS = `id name enabled description nrql{query}
  signal{aggregationWindow aggregationMethod aggregationDelay fillOption fillValue}
  terms{priority operator threshold thresholdDuration thresholdOccurrences}
  expiration{expirationDuration openViolationOnExpiration closeViolationsOnExpiration}
  ... on AlertsNrqlStaticCondition{valueFunction}`

const DASHBOARD_FIELDS = `name permissions pages{name widgets{title layout{column row width height}
  visualization{id} rawConfiguration}}`

async function listPolicy(name: string): Promise<Row | undefined> {
  const data = await graphql(
    'query($a:Int!,$n:String){actor{account(id:$a){alerts{policiesSearch(searchCriteria:{name:$n}){policies{id name incidentPreference}}}}}}',
    { n: name },
  )
  const policies = (data as Row).actor.account.alerts.policiesSearch.policies as Row[]
  return policies.find((policy) => policy.name === name)
}

async function listConditions(policyId: string): Promise<ExistingResource[]> {
  const data = await graphql(
    `query($a:Int!,$p:ID!){actor{account(id:$a){alerts{nrqlConditionsSearch(searchCriteria:{policyId:$p}){nrqlConditions{${CONDITION_FIELDS}}}}}}}`,
    { p: policyId },
  )
  const nodes = (data as Row).actor.account.alerts.nrqlConditionsSearch.nrqlConditions as Row[]
  return nodes.map((node) => ({ id: node.id, name: node.name, spec: conditionSpec(node as never) }))
}

async function listDashboards(name: string): Promise<ExistingResource[]> {
  const search = await graphql(
    'query($q:String!){actor{entitySearch(query:$q){results{entities{guid name}}}}}',
    { q: `type = 'DASHBOARD' AND name = '${name.replaceAll("'", "\\'")}'` },
  )
  const entities = (search as Row).actor.entitySearch.results.entities as Row[]
  return Promise.all(
    entities
      .filter((entity) => entity.name === name)
      .map(async (entity) => {
        const detail = await graphql(
          `query($g:EntityGuid!){actor{entity(guid:$g){... on DashboardEntity{${DASHBOARD_FIELDS}}}}}`,
          { g: entity.guid },
        )
        return { id: entity.guid, name, spec: dashboardSpec((detail as Row).actor.entity as never) }
      }),
  )
}

async function listNotifications() {
  const data = (await graphql(
    `query($a:Int!){actor{account(id:$a){
      aiNotifications{
        destinations{entities{id name type properties{key value}}}
        channels{entities{id name type}}}
      aiWorkflows{workflows{entities{id name}}}}}}`,
  )) as Row
  const { aiNotifications, aiWorkflows } = data.actor.account
  const destinations: ExistingResource[] = aiNotifications.destinations.entities
    .filter((d: Row) => d.type === 'EMAIL')
    .map((d: Row) => ({
      id: d.id,
      name: d.name,
      spec: { type: 'EMAIL', email: destinationEmail(d.properties) },
    }))
  const channels: ExistingResource[] = aiNotifications.channels.entities.map((c: Row) => ({
    id: c.id,
    name: c.name,
    spec: { type: c.type },
  }))
  const workflows: ExistingResource[] = aiWorkflows.workflows.entities.map((w: Row) => ({
    id: w.id,
    name: w.name,
    spec: {},
  }))
  return { destinations, channels, workflows }
}

interface Step {
  row: PlanRow
  run: () => Promise<string>
}

const NO_UPDATE = (row: PlanRow) => () => {
  throw new Error(`${row.kind} "${row.name}" differs from observability/alerts.json; update is not supported, change it in New Relic`)
}

const ERRORS = 'errors{description type}'

async function buildSteps(): Promise<Step[]> {
  const { accountId } = credentials()
  const dashboard = readObservability<DashboardFile>('dashboard.json')
  const alerts = readObservability<AlertsFile>('alerts.json')
  for (const condition of alerts.conditions) {
    if (condition.enabled) assertEnableAllowed(condition, await historySeconds(condition.historyQuery))
  }
  const ids = { policy: '', destination: '', channel: '' }
  const note = alerts.notifications

  const policy = await listPolicy(alerts.policy.name)
  const policySpec = { incidentPreference: alerts.policy.incidentPreference }
  const [policyRow] = planChanges(
    'policy',
    [{ name: alerts.policy.name, spec: policySpec }],
    policy ? [{ id: policy.id, name: policy.name, spec: { incidentPreference: policy.incidentPreference } }] : [],
  )
  const steps: Step[] = [
    {
      row: policyRow,
      run: async () => {
        if (policyRow.action === 'create') {
          const created = await mutate(
            'alertsPolicyCreate',
            'mutation($a:Int!,$p:AlertsPolicyInput!){alertsPolicyCreate(accountId:$a,policy:$p){id name}}',
            { p: { name: alerts.policy.name, incidentPreference: alerts.policy.incidentPreference } },
          )
          return (ids.policy = String(created.id))
        }
        ids.policy = policyRow.id ?? ''
        if (policyRow.action === 'update') {
          await mutate(
            'alertsPolicyUpdate',
            'mutation($a:Int!,$i:ID!,$p:AlertsPolicyUpdateInput!){alertsPolicyUpdate(accountId:$a,id:$i,policy:$p){id}}',
            { i: ids.policy, p: { name: alerts.policy.name, incidentPreference: alerts.policy.incidentPreference } },
          )
        }
        return ids.policy
      },
    },
  ]

  const existing = await listNotifications()
  const [destRow] = planChanges(
    'destination',
    [{ name: note.destinationName, spec: { type: 'EMAIL', email: note.email } }],
    existing.destinations,
  )
  steps.push({
    row: destRow,
    run: async () => {
      if (destRow.action === 'create') {
        const created = await mutate(
          'aiNotificationsCreateDestination',
          `mutation($a:Int!,$d:AiNotificationsDestinationInput!){aiNotificationsCreateDestination(accountId:$a,destination:$d){
            destination{id name}
            error{... on AiNotificationsResponseError{description type details} ... on AiNotificationsDataValidationError{details} ... on AiNotificationsSuggestionError{description type}}}}`,
          { d: destinationInput(note.destinationName, note.email) },
        )
        return (ids.destination = String((created.destination as Row).id))
      }
      if (destRow.action === 'update') NO_UPDATE(destRow)()
      return (ids.destination = destRow.id ?? '')
    },
  })

  const [chanRow] = planChanges(
    'channel',
    [{ name: note.channelName, spec: { type: 'EMAIL' } }],
    existing.channels,
  )
  steps.push({
    row: chanRow,
    run: async () => {
      if (chanRow.action === 'create') {
        const created = await mutate(
          'aiNotificationsCreateChannel',
          `mutation($a:Int!,$c:AiNotificationsChannelInput!){aiNotificationsCreateChannel(accountId:$a,channel:$c){
            channel{id name}
            error{... on AiNotificationsResponseError{description type details} ... on AiNotificationsDataValidationError{details} ... on AiNotificationsSuggestionError{description type}}}}`,
          { c: channelInput(note.channelName, ids.destination, note.channelSubject) },
        )
        return (ids.channel = String((created.channel as Row).id))
      }
      return (ids.channel = chanRow.id ?? '')
    },
  })

  const [wfRow] = planChanges('workflow', [{ name: note.workflowName, spec: {} }], existing.workflows)
  steps.push({
    row: wfRow,
    run: async () => {
      if (wfRow.action !== 'create') return wfRow.id ?? ''
      const created = await mutate(
        'aiWorkflowsCreateWorkflow',
        `mutation($a:Int!,$w:AiWorkflowsCreateWorkflowInput!){aiWorkflowsCreateWorkflow(accountId:$a,createWorkflowData:$w){workflow{id name} ${ERRORS}}}`,
        { w: workflowInput(note.workflowName, ids.policy, ids.channel) },
      )
      return String((created.workflow as Row).id)
    },
  })

  const existingConditions = policy ? await listConditions(policy.id) : []
  const conditionRows = planChanges(
    'condition',
    alerts.conditions.map((c) => ({ name: c.name, spec: conditionSpec(conditionInput(c)) })),
    existingConditions,
  )
  alerts.conditions.forEach((condition: ConditionFile, index) => {
    const row = conditionRows[index]
    steps.push({
      row,
      run: async () => {
        if (row.action === 'noop') return row.id ?? ''
        const input = conditionInput(condition)
        const result =
          row.action === 'create'
            ? await mutate(
                'alertsNrqlConditionStaticCreate',
                'mutation($a:Int!,$p:ID!,$c:AlertsNrqlConditionStaticInput!){alertsNrqlConditionStaticCreate(accountId:$a,policyId:$p,condition:$c){id name enabled}}',
                { p: ids.policy, c: input },
              )
            : await mutate(
                'alertsNrqlConditionStaticUpdate',
                'mutation($a:Int!,$i:ID!,$c:AlertsNrqlConditionUpdateStaticInput!){alertsNrqlConditionStaticUpdate(accountId:$a,id:$i,condition:$c){id name enabled}}',
                { i: row.id, c: input },
              )
        return String(result.id)
      },
    })
  })

  const [dashRow] = planChanges(
    'dashboard',
    [{ name: dashboard.name, spec: dashboardSpec(dashboardInput(dashboard, accountId)) }],
    await listDashboards(dashboard.name),
  )
  steps.push({
    row: dashRow,
    run: async () => {
      if (dashRow.action === 'noop') return dashRow.id ?? ''
      const input = dashboardInput(dashboard, accountId)
      const result =
        dashRow.action === 'create'
          ? await mutate(
              'dashboardCreate',
              'mutation($a:Int!,$d:DashboardInput!){dashboardCreate(accountId:$a,dashboard:$d){entityResult{guid name} errors{description type}}}',
              { d: input },
            )
          : await mutate(
              'dashboardUpdate',
              'mutation($g:EntityGuid!,$d:DashboardInput!){dashboardUpdate(guid:$g,dashboard:$d){entityResult{guid name} errors{description type}}}',
              { g: dashRow.id, d: input },
            )
      return String((result.entityResult as Row).guid)
    },
  })
  return steps
}

function printPlan(steps: Step[]): void {
  for (const { row } of steps) {
    console.log(`${row.kind.padEnd(12)} ${row.action.padEnd(7)} ${row.name}`)
  }
}

async function runApply(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { yes: { type: 'boolean' } } })
  const steps = await buildSteps()
  printPlan(steps)
  if (!values.yes) return console.log('dry run: nothing written (use --yes to apply)')
  for (const step of steps) {
    const id = await step.run()
    console.log(`${step.row.kind.padEnd(12)} ${step.row.action.padEnd(7)} ${step.row.name} ${id}`)
  }
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
  const alerts = readObservability<AlertsFile>('alerts.json')
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
    })
    const stats = seriesStats(series)
    console.log(`  rule: ${condition.operator} ${condition.threshold} for ${condition.thresholdDuration}s in ${condition.aggregationWindow}s windows`)
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
