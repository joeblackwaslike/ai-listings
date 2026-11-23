// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { historyTargetsMatch, parseAlertsFile, parseDashboardFile } from './config'

const condition = {
  name: 'c',
  description: 'd',
  enabled: false,
  nrql: "SELECT count(*) FROM Transaction WHERE appName = 'x'",
  historyQuery: "SELECT earliest(timestamp) FROM Transaction WHERE appName = 'x' SINCE 8 days ago",
  operator: 'ABOVE',
  threshold: 5,
  thresholdDuration: 600,
  aggregationWindow: 300,
  aggregationMethod: 'EVENT_FLOW',
  aggregationDelay: 120,
  fillOption: 'STATIC',
  fillValue: 0,
  expirationDuration: 900,
}

const alerts = {
  policy: { name: 'p', incidentPreference: 'PER_CONDITION' },
  notifications: {
    email: 'joeblackwaslike@gmail.com',
    destinationName: 'd',
    channelName: 'c',
    channelSubject: 's',
    workflowName: 'w',
  },
  conditions: [condition],
}

const withCondition = (patch: Record<string, unknown>) => ({ ...alerts, conditions: [{ ...condition, ...patch }] })

describe('parseAlertsFile', () => {
  test('accepts a valid file', () => {
    expect(parseAlertsFile(alerts).conditions[0].name).toBe('c')
  })

  test('rejects any email but the owner address, naming file and path', () => {
    const bad = { ...alerts, notifications: { ...alerts.notifications, email: 'x@evil.test' } }
    expect(() => parseAlertsFile(bad)).toThrow(/alerts\.json: notifications\.email/)
  })

  test('rejects a second destination, channel or workflow', () => {
    const extra = { ...alerts.notifications, destinations: [{}] }
    expect(() => parseAlertsFile({ ...alerts, notifications: extra })).toThrow(/alerts\.json: notifications/)
    expect(() => parseAlertsFile({ ...alerts, notifications: [alerts.notifications, alerts.notifications] })).toThrow(
      /alerts\.json: notifications/,
    )
  })

  test('requires thresholdDuration to be a multiple of aggregationWindow', () => {
    expect(() => parseAlertsFile(withCondition({ thresholdDuration: 650 }))).toThrow(
      /alerts\.json: conditions\.0\.thresholdDuration/,
    )
  })

  test.each(['FACET', 'since', 'Timeseries'])('rejects %s in a condition nrql', (word) => {
    expect(() => parseAlertsFile(withCondition({ nrql: `${condition.nrql} ${word} 1 hour` }))).toThrow(
      /conditions\.0\.nrql/,
    )
  })

  test('requires a historyQuery of the earliest(timestamp) shape', () => {
    expect(() => parseAlertsFile(withCondition({ historyQuery: 'SELECT count(*) FROM Transaction' }))).toThrow(
      /conditions\.0\.historyQuery/,
    )
  })

  test('requires the historyQuery to read the same event type as the condition', () => {
    expect(() =>
      parseAlertsFile(withCondition({ historyQuery: 'SELECT earliest(timestamp) FROM Log SINCE 8 days ago' })),
    ).toThrow(/conditions\.0\.historyQuery/)
  })

  test('rejects a non numeric threshold and an invalid enum', () => {
    expect(() => parseAlertsFile(withCondition({ threshold: '5' }))).toThrow(/conditions\.0\.threshold/)
    expect(() => parseAlertsFile(withCondition({ operator: 'SIDEWAYS' }))).toThrow(/conditions\.0\.operator/)
    expect(() => parseAlertsFile(withCondition({ fillOption: 'ZERO' }))).toThrow(/conditions\.0\.fillOption/)
  })

  test('rejects unknown keys in a condition', () => {
    expect(() => parseAlertsFile(withCondition({ webhook: 'x' }))).toThrow(/alerts\.json: conditions\.0/)
  })
})

describe('historyTargetsMatch', () => {
  const history = (from: string) => `SELECT earliest(timestamp) FROM ${from} SINCE 8 days ago`

  test('matches on event type', () => {
    expect(historyTargetsMatch('SELECT count(*) FROM Log WHERE a = 1', history('Log WHERE a = 1'))).toBe(true)
    expect(historyTargetsMatch('SELECT count(*) FROM Log', history('Transaction'))).toBe(false)
  })

  test('for Metric requires the metric named by the condition', () => {
    const nrql = 'SELECT sum(inngest_function_run_ended_total) FROM Metric WHERE status != \'completed\''
    expect(historyTargetsMatch(nrql, history("Metric WHERE metricName = 'inngest_function_run_ended_total'"))).toBe(true)
    expect(historyTargetsMatch(nrql, history("Metric WHERE metricName = 'inngest_function_run_started_total'"))).toBe(false)
    expect(historyTargetsMatch(nrql, history('Metric'))).toBe(false)
  })
})

describe('parseDashboardFile', () => {
  const dashboard = {
    name: 'd',
    pages: [
      {
        name: 'p',
        widgets: [
          { title: 't', visualization: 'viz.line', layout: { column: 1, row: 1, width: 4, height: 3 }, nrql: 'SELECT 1' },
        ],
      },
    ],
  }

  test('accepts a valid file', () => {
    expect(parseDashboardFile(dashboard).name).toBe('d')
  })

  test('names the file and path of a bad field', () => {
    const bad = structuredClone(dashboard)
    ;(bad.pages[0].widgets[0].layout as Record<string, unknown>).width = 'wide'
    expect(() => parseDashboardFile(bad)).toThrow(/dashboard\.json: pages\.0\.widgets\.0\.layout\.width/)
  })
})
