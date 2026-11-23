// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import {
  ALLOWED_NOTIFICATION_EMAIL,
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
  type ConditionFile,
} from './alerts'

const condition: ConditionFile = {
  name: 'c',
  description: 'd',
  enabled: false,
  nrql: 'SELECT count(*) FROM Log',
  historyQuery: 'SELECT earliest(timestamp) FROM Log SINCE 8 days ago',
  operator: 'ABOVE',
  threshold: 30,
  thresholdDuration: 600,
  aggregationWindow: 60,
  aggregationMethod: 'EVENT_FLOW',
  aggregationDelay: 120,
  fillOption: 'STATIC',
  fillValue: 0,
  expirationDuration: 900,
}

describe('conditionInput', () => {
  test('builds a CRITICAL only static condition that needs every window to breach', () => {
    const input = conditionInput(condition)
    expect(input.terms).toEqual([
      { priority: 'CRITICAL', operator: 'ABOVE', threshold: 30, thresholdDuration: 600, thresholdOccurrences: 'ALL' },
    ])
    expect(input.nrql).toEqual({ query: 'SELECT count(*) FROM Log' })
    expect(input.signal).toEqual({
      aggregationWindow: 60,
      aggregationMethod: 'EVENT_FLOW',
      aggregationDelay: 120,
      fillOption: 'STATIC',
      fillValue: 0,
    })
    expect(input.expiration).toEqual({
      expirationDuration: 900,
      openViolationOnExpiration: false,
      closeViolationsOnExpiration: true,
    })
    expect(input.valueFunction).toBe('SINGLE_VALUE')
  })

  test('omits fillValue when there is no fill', () => {
    const input = conditionInput({ ...condition, fillOption: 'NONE', fillValue: undefined })
    expect(input.signal.fillOption).toBe('NONE')
    expect('fillValue' in input.signal).toBe(false)
  })
})

describe('conditionSpec', () => {
  test('ignores API-only fields and null placeholders on a read-back condition', () => {
    const input = conditionInput(condition)
    const apiNode = {
      ...input,
      id: '9',
      type: 'STATIC',
      policyId: '1',
      runbookUrl: null,
      signal: { ...input.signal, aggregationTimer: null, slideBy: null },
    }
    expect(conditionSpec(apiNode)).toEqual(conditionSpec(input))
  })

  test('differs when the threshold or enabled flag differs', () => {
    const base = conditionSpec(conditionInput(condition))
    expect(conditionSpec(conditionInput({ ...condition, threshold: 31 }))).not.toEqual(base)
    expect(conditionSpec(conditionInput({ ...condition, enabled: true }))).not.toEqual(base)
  })
})

describe('assertEnableAllowed', () => {
  const week = 7 * 86400

  test('allows a disabled condition with any history', () => {
    expect(() => assertEnableAllowed(condition, 60)).not.toThrow()
  })

  test('refuses an enabled condition with less than 7 days of history', () => {
    expect(() => assertEnableAllowed({ ...condition, enabled: true }, week - 1)).toThrow(
      'cannot enable "c": insufficient history',
    )
  })

  test('refuses an enabled condition with no history at all', () => {
    expect(() => assertEnableAllowed({ ...condition, enabled: true }, null)).toThrow('insufficient history')
  })

  test('allows an enabled condition with 7 days of history', () => {
    expect(() => assertEnableAllowed({ ...condition, enabled: true }, week)).not.toThrow()
  })
})

describe('notification inputs', () => {
  test('builds an email destination', () => {
    expect(destinationInput('dest', 'a@b.c')).toEqual({
      name: 'dest',
      type: 'EMAIL',
      properties: [{ key: 'email', value: 'a@b.c' }],
    })
  })

  test('builds an email channel bound to the destination', () => {
    expect(channelInput('chan', 'dest-id', 'subject')).toEqual({
      name: 'chan',
      type: 'EMAIL',
      destinationId: 'dest-id',
      product: 'IINT',
      properties: [{ key: 'subject', value: 'subject' }],
    })
  })

  test('builds a workflow that notifies only on ACTIVATED for the policy', () => {
    const input = workflowInput('wf', '123', 'chan-id')
    expect(input.destinationConfigurations).toEqual([
      { channelId: 'chan-id', notificationTriggers: ['ACTIVATED'] },
    ])
    expect(input.mutingRulesHandling).toBe('DONT_NOTIFY_FULLY_MUTED_ISSUES')
    expect(input.issuesFilter.predicates).toEqual([
      { attribute: 'labels.policyIds', operator: 'EXACTLY_MATCHES', values: ['123'] },
    ])
  })
})

describe('destinationEmail', () => {
  test('reads the address from email or, when New Relic blanks it, link_sent_email', () => {
    expect(destinationEmail([{ key: 'email', value: 'a@b.c' }])).toBe('a@b.c')
    expect(
      destinationEmail([
        { key: 'email', value: '' },
        { key: 'link_sent_email', value: 'a@b.c' },
      ]),
    ).toBe('a@b.c')
    expect(destinationEmail([])).toBeUndefined()
  })
})

describe('notification allowlist', () => {
  test('only the owner address is allowed', () => {
    expect(ALLOWED_NOTIFICATION_EMAIL).toBe('joeblackwaslike@gmail.com')
  })
})

describe('channelSpec', () => {
  test('reads the same spec from a built input and from API fields', () => {
    const fromApi = { type: 'EMAIL', destinationId: 'd', properties: [{ key: 'subject', value: 's' }], id: '1' }
    expect(channelSpec(fromApi)).toEqual(channelSpec(channelInput('c', 'd', 's')))
    expect(channelSpec(fromApi)).toEqual({ type: 'EMAIL', destinationId: 'd', subject: 's' })
  })
})

describe('channelUpdateInput', () => {
  test('updates only the subject property', () => {
    expect(channelUpdateInput('c', 's')).toEqual({ name: 'c', properties: [{ key: 'subject', value: 's' }] })
  })
})

describe('workflowSpec', () => {
  const api = {
    workflowEnabled: true,
    destinationsEnabled: true,
    mutingRulesHandling: 'DONT_NOTIFY_FULLY_MUTED_ISSUES',
    issuesFilter: {
      id: 'f',
      name: 'policy',
      type: 'FILTER',
      predicates: [{ attribute: 'labels.policyIds', operator: 'EXACTLY_MATCHES', values: ['123'] }],
    },
    destinationConfigurations: [
      { channelId: 'c', type: 'EMAIL', notificationTriggers: ['ACTIVATED'], updateOriginalMessage: false },
    ],
  }

  test('matches a built input and ignores API-only fields', () => {
    expect(workflowSpec(api)).toEqual(workflowSpec(workflowInput('wf', '123', 'c')))
  })

  test('differs when the muting handling, triggers, policy or channel change', () => {
    const base = workflowSpec(workflowInput('wf', '123', 'c'))
    expect(workflowSpec({ ...api, mutingRulesHandling: 'NOTIFY_ALL_ISSUES' })).not.toEqual(base)
    expect(
      workflowSpec({
        ...api,
        destinationConfigurations: [{ channelId: 'c', notificationTriggers: ['ACTIVATED', 'CLOSED'] }],
      }),
    ).not.toEqual(base)
    expect(workflowSpec(workflowInput('wf', '999', 'c'))).not.toEqual(base)
    expect(workflowSpec(workflowInput('wf', '123', 'other'))).not.toEqual(base)
  })
})

describe('workflowUpdateInput', () => {
  test('targets the workflow and existing filter ids', () => {
    const input = workflowUpdateInput('w1', 'f1', workflowInput('wf', '123', 'c'))
    expect(input.id).toBe('w1')
    expect(input.issuesFilter.id).toBe('f1')
    expect(input.issuesFilter.filterInput.predicates[0].values).toEqual(['123'])
    expect(input.mutingRulesHandling).toBe('DONT_NOTIFY_FULLY_MUTED_ISSUES')
    expect(input).not.toHaveProperty('name')
  })
})
