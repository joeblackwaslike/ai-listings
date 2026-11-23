// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import {
  assertEnableAllowed,
  channelInput,
  conditionInput,
  conditionSpec,
  destinationEmail,
  destinationInput,
  workflowInput,
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
    const input = channelInput('chan', 'dest-id', 'subject')
    expect(input).toMatchObject({ name: 'chan', type: 'EMAIL', destinationId: 'dest-id', product: 'IINT' })
    expect(input.properties).toContainEqual({ key: 'subject', value: 'subject' })
  })

  test('builds a workflow that notifies only on ACTIVATED for the policy', () => {
    const input = workflowInput('wf', '123', 'chan-id')
    expect(input.destinationConfigurations).toEqual([
      { channelId: 'chan-id', notificationTriggers: ['ACTIVATED'] },
    ])
    expect(input.mutingRulesHandling).toBe('NOTIFY_ALL_ISSUES')
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
