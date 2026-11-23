// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import {
  type AlertsFile,
  channelInput,
  conditionInput,
  destinationInput,
  workflowInput,
} from './alerts'
import { allPages, assertApplicable, applyPlan, buildPlan, escapeEntityName, type ApplyDeps } from './apply'
import { type DashboardFile, dashboardInput } from './dashboard'

const alerts: AlertsFile = {
  policy: { name: 'pol', incidentPreference: 'PER_CONDITION' },
  notifications: {
    email: 'joeblackwaslike@gmail.com',
    destinationName: 'dest',
    channelName: 'chan',
    channelSubject: 'subj',
    workflowName: 'wf',
  },
  conditions: [
    {
      name: 'c1',
      description: 'd',
      enabled: false,
      nrql: 'SELECT count(*) FROM Log',
      historyQuery: 'SELECT earliest(timestamp) FROM Log SINCE 8 days ago',
      operator: 'ABOVE',
      threshold: 5,
      thresholdDuration: 600,
      aggregationWindow: 60,
      aggregationMethod: 'EVENT_FLOW',
      aggregationDelay: 120,
      fillOption: 'STATIC',
      fillValue: 0,
      expirationDuration: 900,
    },
  ],
}

const dashboard: DashboardFile = {
  name: 'dash',
  pages: [
    {
      name: 'p',
      widgets: [{ title: 'w', visualization: 'viz.line', layout: { column: 1, row: 1, width: 4, height: 3 }, nrql: 'SELECT 1' }],
    },
  ],
}

type Json = Record<string, unknown>

interface World {
  policies?: Json[]
  conditions?: Json[]
  destinations?: Json[]
  channels?: Json[]
  workflows?: Json[]
  dashboards?: Json[]
  channelPages?: Json[][]
  historyMs?: number | null
}

const page = (entities: Json[], key = 'entities') => ({ [key]: entities, nextCursor: null })

function fake(world: World) {
  const mutations: { field: string; variables: Json }[] = []
  const queries: string[] = []
  const deps: ApplyDeps = {
    accountId: 42,
    async nrql() {
      return world.historyMs === undefined || world.historyMs === null ? [{}] : [{ 'earliest.timestamp': Date.now() - world.historyMs }]
    },
    async graphql(query, variables = {}) {
      queries.push(query)
      const acct = (value: Json) => ({ actor: { account: value } })
      if (query.includes('policiesSearch')) return acct({ alerts: { policiesSearch: page(world.policies ?? [], 'policies') } })
      if (query.includes('nrqlConditionsSearch'))
        return acct({ alerts: { nrqlConditionsSearch: page(world.conditions ?? [], 'nrqlConditions') } })
      if (query.includes('destinations('))
        return acct({ aiNotifications: { destinations: page(world.destinations ?? []) } })
      if (query.includes('channels(')) {
        const pages = world.channelPages ?? [world.channels ?? []]
        const index = variables.c ? Number(variables.c) : 0
        const next = index + 1 < pages.length ? String(index + 1) : null
        return acct({ aiNotifications: { channels: { entities: pages[index], nextCursor: next } } })
      }
      if (query.includes('workflows(')) return acct({ aiWorkflows: { workflows: page(world.workflows ?? []) } })
      if (query.includes('entitySearch'))
        return { actor: { entitySearch: { results: page((world.dashboards ?? []).map((d) => ({ guid: d.guid, name: d.name, accountId: d.accountId ?? 42 }))) } } }
      if (query.includes('entity(guid'))
        return { actor: { entity: (world.dashboards ?? []).find((d) => d.guid === variables.g) } }
      throw new Error(`unexpected query ${query}`)
    },
    async mutate(field, _query, variables) {
      mutations.push({ field, variables })
      const id = `${field}-id`
      return { id, destination: { id }, channel: { id }, workflow: { id }, entityResult: { guid: id } }
    },
  }
  return { deps, mutations, queries }
}

const apiCondition = (id: string, patch: Json = {}) => {
  const input = conditionInput(alerts.conditions[0])
  return { id, ...input, ...patch }
}

const syncedWorld = (patch: World = {}): World => ({
  policies: [{ id: 'P', name: 'pol', incidentPreference: 'PER_CONDITION' }],
  conditions: [apiCondition('C1')],
  destinations: [
    { id: 'D', name: 'dest', type: 'EMAIL', properties: destinationInput('dest', alerts.notifications.email).properties },
  ],
  channels: [{ id: 'CH', ...channelInput('chan', 'D', 'subj') }],
  workflows: [{ id: 'W', ...workflowInput('wf', 'P', 'CH'), issuesFilter: { id: 'F', ...workflowInput('wf', 'P', 'CH').issuesFilter } }],
  dashboards: [{ guid: 'G', ...dashboardEntity() }],
  ...patch,
})

function dashboardEntity() {
  const input = dashboardInput(dashboard, 42)
  return { name: input.name, permissions: input.permissions, pages: input.pages }
}

const run = async (world: World, file: AlertsFile = alerts) => {
  const env = fake(world)
  const plan = await buildPlan(env.deps, file, dashboard)
  return { ...env, plan }
}

describe('buildPlan on an empty account', () => {
  test('creates everything and threads ids between steps', async () => {
    const { plan, mutations } = await run({})
    expect(plan.steps.map((s) => `${s.row.kind}:${s.row.action}`)).toEqual([
      'policy:create',
      'destination:create',
      'channel:create',
      'workflow:create',
      'condition:create',
      'dashboard:create',
    ])
    await applyPlan(plan)
    const by = (field: string) => mutations.find((m) => m.field === field)?.variables as Json
    expect(by('alertsNrqlConditionStaticCreate').p).toBe('alertsPolicyCreate-id')
    expect((by('aiNotificationsCreateChannel').c as Json).destinationId).toBe('aiNotificationsCreateDestination-id')
    const workflow = by('aiWorkflowsCreateWorkflow').w as ReturnType<typeof workflowInput>
    expect(workflow.destinationConfigurations[0].channelId).toBe('aiNotificationsCreateChannel-id')
    expect(workflow.issuesFilter.predicates[0].values).toEqual(['alertsPolicyCreate-id'])
  })

  test('fails when a create mutation returns no id', async () => {
    const env = fake({})
    env.deps.mutate = async () => ({})
    const plan = await buildPlan(env.deps, alerts, dashboard)
    await expect(applyPlan(plan)).rejects.toThrow('alertsPolicyCreate returned no id')
  })
})

describe('buildPlan on a synced account', () => {
  test('every row is a noop and apply makes zero mutations', async () => {
    const { plan, mutations } = await run(syncedWorld())
    expect(plan.steps.map((s) => s.row.action)).toEqual(Array(6).fill('noop'))
    expect(plan.orphans).toEqual([])
    await applyPlan(plan)
    expect(mutations).toEqual([])
  })

  test('lists conditions that are not in alerts.json as orphans', async () => {
    const world = syncedWorld()
    world.conditions = [...(world.conditions ?? []), apiCondition('C9', { name: 'old condition' })]
    const { plan } = await run(world)
    expect(plan.orphans).toEqual([{ kind: 'condition', name: 'old condition', action: 'orphan', id: 'C9' }])
  })

  test('a changed condition is updated in place', async () => {
    const { plan, mutations } = await run(syncedWorld({ conditions: [apiCondition('C1', { enabled: true })] }))
    expect(plan.steps[4].row).toMatchObject({ action: 'update', id: 'C1' })
    await applyPlan(plan)
    expect(mutations.map((m) => m.field)).toEqual(['alertsNrqlConditionStaticUpdate'])
  })

  test('a workflow with different muting handling is updated through the filter id', async () => {
    const world = syncedWorld()
    world.workflows = [{ ...(world.workflows?.[0] as Json), mutingRulesHandling: 'NOTIFY_ALL_ISSUES' }]
    const { plan, mutations } = await run(world)
    expect(plan.steps[3].row.action).toBe('update')
    await applyPlan(plan)
    const [update] = mutations
    expect(update.field).toBe('aiWorkflowsUpdateWorkflow')
    const input = update.variables.w as ReturnType<typeof import('./alerts').workflowUpdateInput>
    expect(input).toMatchObject({ id: 'W', mutingRulesHandling: 'DONT_NOTIFY_FULLY_MUTED_ISSUES' })
    expect(input.issuesFilter.id).toBe('F')
  })

  test('a channel with a different subject is updated', async () => {
    const world = syncedWorld()
    world.channels = [{ ...(world.channels?.[0] as Json), ...channelInput('chan', 'D', 'old') }]
    const { plan, mutations } = await run(world)
    expect(plan.steps[2].row.action).toBe('update')
    await applyPlan(plan)
    expect(mutations.map((m) => m.field)).toEqual(['aiNotificationsUpdateChannel'])
    expect(mutations[0].variables).toMatchObject({ i: 'CH', c: { name: 'chan', properties: [{ key: 'subject', value: 'subj' }] } })
  })
})

describe('refused rows', () => {
  test('a different destination email is refused and blocks every write', async () => {
    const world = syncedWorld()
    world.destinations = [{ id: 'D', name: 'dest', type: 'EMAIL', properties: [{ key: 'email', value: 'other@x.test' }] }]
    world.conditions = [apiCondition('C1', { enabled: true })]
    const { plan, mutations } = await run(world)
    expect(plan.steps[1].row.action).toBe('refused')
    expect(() => assertApplicable(plan)).toThrow('destination "dest"')
    await expect(applyPlan(plan)).rejects.toThrow('destination "dest"')
    expect(mutations).toEqual([])
  })

  test('a channel bound to another destination is refused', async () => {
    const world = syncedWorld()
    world.channels = [{ ...(world.channels?.[0] as Json), destinationId: 'OTHER' }]
    const { plan } = await run(world)
    expect(plan.steps[2].row.action).toBe('refused')
  })
})

describe('enable guard', () => {
  const enabled: AlertsFile = { ...alerts, conditions: [{ ...alerts.conditions[0], enabled: true }] }

  test('blocks enabling a condition without 7 days of history', async () => {
    const env = fake({ historyMs: 3600_000 })
    await expect(buildPlan(env.deps, enabled, dashboard)).rejects.toThrow('cannot enable "c1"')
    expect(env.mutations).toEqual([])
  })

  test('allows enabling with 8 days of history', async () => {
    const env = fake({ historyMs: 8 * 86400_000 })
    await expect(buildPlan(env.deps, enabled, dashboard)).resolves.toBeDefined()
  })
})

describe('pagination', () => {
  test('follows nextCursor across pages', async () => {
    const world = syncedWorld()
    const channel = world.channels?.[0] as Json
    world.channelPages = [[{ ...channel, id: 'X', name: 'other' }], [channel]]
    const { plan } = await run(world)
    expect(plan.steps[2].row).toMatchObject({ action: 'noop', id: 'CH' })
  })

  test('allPages throws when the cursor never ends', async () => {
    await expect(allPages('things', async () => ({ items: [1], nextCursor: 'again' }))).rejects.toThrow(
      'things: more than 20 pages',
    )
  })
})

describe('escapeEntityName', () => {
  test('escapes the backslash before the quote', () => {
    expect(escapeEntityName("a\\'b")).toBe("a\\\\\\'b")
    expect(escapeEntityName("it's")).toBe("it\\'s")
  })
})

describe('dashboard discovery', () => {
  test('scopes the entity search to the configured account', async () => {
    const { variables } = await capturedSearchVariables()
    expect(variables.q).toContain('AND accountId = 42')
  })

  test('never selects a dashboard of the same name from another account', async () => {
    const foreign = { ...syncedWorld().dashboards?.[0], guid: 'FOREIGN', accountId: 99 }
    const { plan } = await run(syncedWorld({ dashboards: [foreign] }))
    const row = plan.steps.find((step) => step.row.kind === 'dashboard')?.row
    expect(row?.action).toBe('create')
    expect(row?.id).toBeUndefined()
  })
})

async function capturedSearchVariables() {
  const env = fake(syncedWorld())
  const seen: Record<string, string>[] = []
  const graphql = env.deps.graphql
  env.deps.graphql = async (query, variables = {}) => {
    if (query.includes('entitySearch')) seen.push(variables as Record<string, string>)
    return graphql(query, variables)
  }
  await buildPlan(env.deps, alerts, dashboard)
  return { variables: seen[0] }
}
