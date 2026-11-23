// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { auditDiff, logsQuery } from './nrql'

describe('logsQuery', () => {
  test('uses a one hour window and a limit of 50 by default', () => {
    const query = logsQuery({})
    expect(query).toContain('FROM Log')
    expect(query).toContain('SINCE 1 hour ago')
    expect(query).toContain('LIMIT 50')
    expect(query).not.toContain('WHERE')
  })

  test('filters by namespace and adds the error pattern when errorsOnly is set', () => {
    const query = logsQuery({ namespace: 'ai-listings', errorsOnly: true })
    expect(query).toContain("namespace_name = 'ai-listings'")
    expect(query).toContain("message RLIKE '(?i).*(error|exception|fail|fatal).*'")
  })

  test('excludes the auth proxy_check diagnostics that match the error pattern but are not errors', () => {
    const query = logsQuery({ errorsOnly: true })
    expect(query).toContain(`message NOT LIKE '%"event":"proxy_check"%'`)
    expect(query).toContain(`message NOT LIKE '%"event":"proxy_redirect_to_login"%'`)
  })

  test('does not add the exclusion when errorsOnly is not set', () => {
    expect(logsQuery({})).not.toContain('proxy_check')
  })

  test('doubles single quotes in grep text', () => {
    const query = logsQuery({ grep: "it's" })
    expect(query).toContain("it''s")
    expect(query).not.toMatch(/[^']'s/)
  })

  test('doubles single quotes in the namespace', () => {
    expect(logsQuery({ namespace: "a'b" })).toContain("namespace_name = 'a''b'")
  })

  test('honors custom since and limit', () => {
    const query = logsQuery({ since: '3 days', limit: 200 })
    expect(query).toContain('SINCE 3 days ago')
    expect(query).toContain('LIMIT 200')
  })

  test('rejects a since value that is not a number and a unit', () => {
    expect(() => logsQuery({ since: "1 hour ago' OR 1=1" })).toThrow(/since/)
  })

  test('rejects a limit outside 1 to 2000 or a non-integer', () => {
    expect(() => logsQuery({ limit: 0 })).toThrow(/limit/)
    expect(() => logsQuery({ limit: 2001 })).toThrow(/limit/)
    expect(() => logsQuery({ limit: 1.5 })).toThrow(/limit/)
  })
})

describe('auditDiff', () => {
  const expected = [
    { namespace: 'ai-listings', name: 'ai-listings' },
    { namespace: 'supabase', name: 'supabase-kong' },
  ]

  test('reports a workload with no matching row as missing', () => {
    const result = auditDiff(expected, [{ namespace: 'ai-listings', container: 'ai-listings' }])
    expect(result.missing).toEqual([{ namespace: 'supabase', name: 'supabase-kong' }])
  })

  test('treats a container name prefixed by the workload name as seen', () => {
    const result = auditDiff(expected, [
      { namespace: 'ai-listings', container: 'ai-listings-7f9c' },
      { namespace: 'supabase', container: 'supabase-kong' },
    ])
    expect(result.missing).toEqual([])
  })

  test('does not match a row from a different namespace', () => {
    const result = auditDiff(expected, [
      { namespace: 'other', container: 'ai-listings' },
      { namespace: 'supabase', container: 'supabase-kong' },
    ])
    expect(result.missing).toEqual([{ namespace: 'ai-listings', name: 'ai-listings' }])
  })

  test('marks every expected workload missing when nothing was seen', () => {
    expect(auditDiff(expected, []).missing).toEqual(expected)
  })

  test('applies no filtering of its own beyond namespace and container prefix', () => {
    const workloads = [{ namespace: 'supabase', name: 'supabase-studio' }]
    expect(auditDiff(workloads, []).missing).toEqual(workloads)
    expect(auditDiff([], [{ namespace: 'x', container: 'y' }]).missing).toEqual([])
  })
})
