import { z } from 'zod'
import {
  type AlertsFile,
  type ConditionFile,
  assertEnableAllowed,
  channelInput,
  channelSpec,
  channelUpdateInput,
  conditionInput,
  conditionSpec,
  destinationEmail,
  destinationInput,
  workflowInput,
  workflowSpec,
  workflowUpdateInput,
} from './alerts'
import { type DashboardFile, dashboardInput, dashboardSpec } from './dashboard'
import { requireId } from './nerdgraph'
import { type ExistingResource, type PlanRow, findOrphans, planChanges } from './plan'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

export interface ApplyDeps {
  accountId: number
  graphql: (query: string, variables?: Record<string, unknown>) => Promise<Row>
  mutate: (field: string, query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown>>
  nrql: (query: string) => Promise<unknown[]>
}

export interface Step {
  row: PlanRow
  run: () => Promise<string>
}

export interface Plan {
  steps: Step[]
  orphans: PlanRow[]
}

const MAX_PAGES = 20
const MUTATION_ERROR =
  'error{... on AiNotificationsResponseError{description type details} ... on AiNotificationsDataValidationError{details} ... on AiNotificationsSuggestionError{description type}}'
const WORKFLOW_ERRORS = 'errors{description type}'

const CONDITION_FIELDS = `id name enabled description nrql{query}
  signal{aggregationWindow aggregationMethod aggregationDelay fillOption fillValue}
  terms{priority operator threshold thresholdDuration thresholdOccurrences}
  expiration{expirationDuration openViolationOnExpiration closeViolationsOnExpiration}
  ... on AlertsNrqlStaticCondition{valueFunction}`

const DASHBOARD_FIELDS = `name permissions pages{name widgets{title layout{column row width height}
  visualization{id} rawConfiguration}}`

export async function allPages<T>(
  label: string,
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor?: string | null }>,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const result = await fetchPage(cursor)
    items.push(...result.items)
    if (!result.nextCursor) return items
    cursor = result.nextCursor
  }
  throw new Error(`${label}: more than ${MAX_PAGES} pages`)
}

export function escapeEntityName(name: string): string {
  return name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function historySeconds(deps: ApplyDeps, historyQuery: string): Promise<number | null> {
  const [row] = (await deps.nrql(historyQuery)) as Row[]
  const earliest = row?.['earliest.timestamp']
  return typeof earliest === 'number' ? Math.round((Date.now() - earliest) / 1000) : null
}

async function listPolicy(deps: ApplyDeps, name: string): Promise<Row | undefined> {
  const policies = await allPages<Row>('policies', async (cursor) => {
    const data = await deps.graphql(
      'query($a:Int!,$n:String,$c:String){actor{account(id:$a){alerts{policiesSearch(searchCriteria:{name:$n},cursor:$c){policies{id name incidentPreference} nextCursor}}}}}',
      { n: name, c: cursor },
    )
    const search = data.actor.account.alerts.policiesSearch
    return { items: search.policies, nextCursor: search.nextCursor }
  })
  return policies.find((policy) => policy.name === name)
}

async function listConditions(deps: ApplyDeps, policyId: string): Promise<ExistingResource[]> {
  const nodes = await allPages<Row>('conditions', async (cursor) => {
    const data = await deps.graphql(
      `query($a:Int!,$p:ID!,$c:String){actor{account(id:$a){alerts{nrqlConditionsSearch(searchCriteria:{policyId:$p},cursor:$c){nrqlConditions{${CONDITION_FIELDS}} nextCursor}}}}}`,
      { p: policyId, c: cursor },
    )
    const search = data.actor.account.alerts.nrqlConditionsSearch
    return { items: search.nrqlConditions, nextCursor: search.nextCursor }
  })
  return nodes.map((node) => ({ id: node.id, name: node.name, spec: conditionSpec(node as never) }))
}

async function listDashboards(deps: ApplyDeps, name: string): Promise<ExistingResource[]> {
  const accountId = z.number().int().positive().parse(deps.accountId)
  const entities = await allPages<Row>('dashboards', async (cursor) => {
    const data = await deps.graphql(
      'query($q:String!,$c:String){actor{entitySearch(query:$q){results(cursor:$c){entities{guid name accountId} nextCursor}}}}',
      { q: `type = 'DASHBOARD' AND name = '${escapeEntityName(name)}' AND accountId = ${accountId}`, c: cursor },
    )
    const results = data.actor.entitySearch.results
    return { items: results.entities, nextCursor: results.nextCursor }
  })
  return Promise.all(
    entities
      .filter((entity) => entity.name === name && entity.accountId === accountId)
      .map(async (entity) => {
        const detail = await deps.graphql(
          `query($g:EntityGuid!){actor{entity(guid:$g){... on DashboardEntity{${DASHBOARD_FIELDS}}}}}`,
          { g: entity.guid },
        )
        return { id: entity.guid, name, spec: dashboardSpec(detail.actor.entity as never) }
      }),
  )
}

interface ExistingWithMeta extends ExistingResource {
  meta?: Row
}

async function listDestinations(deps: ApplyDeps): Promise<ExistingWithMeta[]> {
  const nodes = await allPages<Row>('destinations', async (cursor) => {
    const data = await deps.graphql(
      'query($a:Int!,$c:String){actor{account(id:$a){aiNotifications{destinations(cursor:$c){entities{id name type properties{key value}} nextCursor}}}}}',
      { c: cursor },
    )
    const result = data.actor.account.aiNotifications.destinations
    return { items: result.entities, nextCursor: result.nextCursor }
  })
  return nodes
    .filter((d) => d.type === 'EMAIL')
    .map((d) => ({ id: d.id, name: d.name, spec: { type: 'EMAIL', email: destinationEmail(d.properties) } }))
}

async function listChannels(deps: ApplyDeps): Promise<ExistingWithMeta[]> {
  const nodes = await allPages<Row>('channels', async (cursor) => {
    const data = await deps.graphql(
      'query($a:Int!,$c:String){actor{account(id:$a){aiNotifications{channels(cursor:$c){entities{id name type destinationId properties{key value}} nextCursor}}}}}',
      { c: cursor },
    )
    const result = data.actor.account.aiNotifications.channels
    return { items: result.entities, nextCursor: result.nextCursor }
  })
  return nodes.map((c) => ({
    id: c.id,
    name: c.name,
    spec: channelSpec(c as never),
    meta: { destinationId: c.destinationId },
  }))
}

async function listWorkflows(deps: ApplyDeps): Promise<ExistingWithMeta[]> {
  const nodes = await allPages<Row>('workflows', async (cursor) => {
    const data = await deps.graphql(
      `query($a:Int!,$c:String){actor{account(id:$a){aiWorkflows{workflows(cursor:$c){entities{id name workflowEnabled destinationsEnabled mutingRulesHandling
        issuesFilter{id name type predicates{attribute operator values}}
        destinationConfigurations{channelId notificationTriggers}} nextCursor}}}}}`,
      { c: cursor },
    )
    const result = data.actor.account.aiWorkflows.workflows
    return { items: result.entities, nextCursor: result.nextCursor }
  })
  return nodes.map((w) => ({
    id: w.id,
    name: w.name,
    spec: workflowSpec(w as never),
    meta: { filterId: w.issuesFilter?.id },
  }))
}

function refuseRow(row: PlanRow): () => never {
  return () => {
    throw new Error(`${row.kind} "${row.name}" differs from observability/alerts.json; update is not supported, change it in New Relic`)
  }
}

export async function buildPlan(deps: ApplyDeps, alerts: AlertsFile, dashboard: DashboardFile): Promise<Plan> {
  for (const condition of alerts.conditions) {
    if (condition.enabled) assertEnableAllowed(condition, await historySeconds(deps, condition.historyQuery))
  }
  const ids = { policy: '', destination: '', channel: '' }
  const note = alerts.notifications
  const { mutate } = deps

  const policy = await listPolicy(deps, alerts.policy.name)
  const [policyRow] = planChanges(
    'policy',
    [{ name: alerts.policy.name, spec: { incidentPreference: alerts.policy.incidentPreference } }],
    policy ? [{ id: policy.id, name: policy.name, spec: { incidentPreference: policy.incidentPreference } }] : [],
  )
  const policyInput = { name: alerts.policy.name, incidentPreference: alerts.policy.incidentPreference }
  const steps: Step[] = [
    {
      row: policyRow,
      run: async () => {
        if (policyRow.action === 'create') {
          const created = await mutate(
            'alertsPolicyCreate',
            'mutation($a:Int!,$p:AlertsPolicyInput!){alertsPolicyCreate(accountId:$a,policy:$p){id name}}',
            { p: policyInput },
          )
          return (ids.policy = requireId(created, 'alertsPolicyCreate'))
        }
        ids.policy = requireId(policyRow as never, 'policy')
        if (policyRow.action === 'update') {
          await mutate(
            'alertsPolicyUpdate',
            'mutation($a:Int!,$i:ID!,$p:AlertsPolicyUpdateInput!){alertsPolicyUpdate(accountId:$a,id:$i,policy:$p){id}}',
            { i: ids.policy, p: policyInput },
          )
        }
        return ids.policy
      },
    },
  ]

  const destinations = await listDestinations(deps)
  const [destRow] = planChanges(
    'destination',
    [{ name: note.destinationName, spec: { type: 'EMAIL', email: note.email } }],
    destinations,
    { createOnly: true },
  )
  steps.push({
    row: destRow,
    run: async () => {
      if (destRow.action === 'refused') refuseRow(destRow)()
      if (destRow.action === 'create') {
        const created = await mutate(
          'aiNotificationsCreateDestination',
          `mutation($a:Int!,$d:AiNotificationsDestinationInput!){aiNotificationsCreateDestination(accountId:$a,destination:$d){
            destination{id name} ${MUTATION_ERROR}}}`,
          { d: destinationInput(note.destinationName, note.email) },
        )
        return (ids.destination = requireId(created.destination as Row, 'aiNotificationsCreateDestination'))
      }
      return (ids.destination = requireId(destRow as never, 'destination'))
    },
  })

  const channels = await listChannels(deps)
  const existingChannel = channels.find((c) => c.name === note.channelName)
  const desiredChannel = channelSpec(channelInput(note.channelName, destRow.id ?? '', note.channelSubject))
  const [plannedChannel] = planChanges('channel', [{ name: note.channelName, spec: desiredChannel }], channels)
  const rebound = plannedChannel.action === 'update' && existingChannel?.meta?.destinationId !== destRow.id
  const chanRow: PlanRow = rebound ? { ...plannedChannel, action: 'refused' } : plannedChannel
  steps.push({
    row: chanRow,
    run: async () => {
      if (chanRow.action === 'refused') refuseRow(chanRow)()
      if (chanRow.action === 'create') {
        const created = await mutate(
          'aiNotificationsCreateChannel',
          `mutation($a:Int!,$c:AiNotificationsChannelInput!){aiNotificationsCreateChannel(accountId:$a,channel:$c){
            channel{id name} ${MUTATION_ERROR}}}`,
          { c: channelInput(note.channelName, ids.destination, note.channelSubject) },
        )
        return (ids.channel = requireId(created.channel as Row, 'aiNotificationsCreateChannel'))
      }
      ids.channel = requireId(chanRow as never, 'channel')
      if (chanRow.action === 'update') {
        await mutate(
          'aiNotificationsUpdateChannel',
          `mutation($a:Int!,$i:ID!,$c:AiNotificationsChannelUpdate!){aiNotificationsUpdateChannel(accountId:$a,channelId:$i,channel:$c){
            channel{id name} ${MUTATION_ERROR}}}`,
          { i: ids.channel, c: channelUpdateInput(note.channelName, note.channelSubject) },
        )
      }
      return ids.channel
    },
  })

  const workflows = await listWorkflows(deps)
  const existingWorkflow = workflows.find((w) => w.name === note.workflowName)
  const [wfRow] = planChanges(
    'workflow',
    [{ name: note.workflowName, spec: workflowSpec(workflowInput(note.workflowName, policyRow.id ?? '', chanRow.id ?? '')) }],
    workflows,
  )
  steps.push({
    row: wfRow,
    run: async () => {
      if (wfRow.action === 'noop') return wfRow.id ?? ''
      const input = workflowInput(note.workflowName, ids.policy, ids.channel)
      if (wfRow.action === 'create') {
        const created = await mutate(
          'aiWorkflowsCreateWorkflow',
          `mutation($a:Int!,$w:AiWorkflowsCreateWorkflowInput!){aiWorkflowsCreateWorkflow(accountId:$a,createWorkflowData:$w){workflow{id name} ${WORKFLOW_ERRORS}}}`,
          { w: input },
        )
        return requireId(created.workflow as Row, 'aiWorkflowsCreateWorkflow')
      }
      await mutate(
        'aiWorkflowsUpdateWorkflow',
        `mutation($a:Int!,$w:AiWorkflowsUpdateWorkflowInput!){aiWorkflowsUpdateWorkflow(accountId:$a,deleteUnusedChannels:false,updateWorkflowData:$w){workflow{id name} ${WORKFLOW_ERRORS}}}`,
        { w: workflowUpdateInput(requireId(wfRow as never, 'workflow'), existingWorkflow?.meta?.filterId, input) },
      )
      return wfRow.id ?? ''
    },
  })

  const existingConditions = policy ? await listConditions(deps, policy.id) : []
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
        if (row.action === 'noop') return requireId(row as never, 'condition')
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
        return requireId(result, 'alertsNrqlCondition')
      },
    })
  })

  const [dashRow] = planChanges(
    'dashboard',
    [{ name: dashboard.name, spec: dashboardSpec(dashboardInput(dashboard, deps.accountId)) }],
    await listDashboards(deps, dashboard.name),
  )
  steps.push({
    row: dashRow,
    run: async () => {
      if (dashRow.action === 'noop') return dashRow.id ?? ''
      const input = dashboardInput(dashboard, deps.accountId)
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
      return requireId(result.entityResult as Row, 'dashboardCreate', 'guid')
    },
  })

  const orphans = policy
    ? findOrphans('condition', alerts.conditions.map((c) => c.name), existingConditions)
    : []
  return { steps, orphans }
}

export function assertApplicable(plan: Plan): void {
  const refused = plan.steps.filter((step) => step.row.action === 'refused')
  if (refused.length === 0) return
  const names = refused.map(({ row }) => `${row.kind} "${row.name}"`).join(', ')
  throw new Error(
    `refused, nothing written: ${names} differs from observability/alerts.json and cannot be updated; change it in New Relic`,
  )
}

export async function applyPlan(
  plan: Plan,
  report: (row: PlanRow, id: string) => void = () => {},
): Promise<void> {
  assertApplicable(plan)
  for (const step of plan.steps) report(step.row, await step.run())
}
