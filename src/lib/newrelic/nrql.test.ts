// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { auditDiff, logsQuery, SINCE_PATTERN } from './nrql'

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

  test('backslash-escapes single quotes in grep text', () => {
    expect(logsQuery({ grep: "it's" })).toContain("message LIKE '%it\\'s%'")
  })

  test('doubles backslashes in grep text', () => {
    expect(logsQuery({ grep: 'a\\' })).toContain("message LIKE '%a\\\\%'")
  })

  test('keeps an injection attempt inside the literal', () => {
    expect(logsQuery({ grep: "x' OR 1=1 --" })).toContain("message LIKE '%x\\' OR 1=1 --%'")
  })

  test('backslash-escapes single quotes in the namespace', () => {
    expect(logsQuery({ namespace: "a'b" })).toContain("namespace_name = 'a\\'b'")
  })

  test('grep alone does not add an RLIKE condition', () => {
    expect(logsQuery({ grep: 'x' })).not.toContain('RLIKE')
  })

  test('combines namespace, grep and errorsOnly in one golden query', () => {
    expect(logsQuery({ namespace: 'ns', grep: 'boom', errorsOnly: true })).toBe(
      "SELECT timestamp, namespace_name, container_name, pod_name, message FROM Log WHERE namespace_name = 'ns' AND message LIKE '%boom%' AND message RLIKE '(?i).*(error|exception|fail|fatal).*' AND message NOT LIKE '%\"event\":\"proxy_check\"%' AND message NOT LIKE '%\"event\":\"proxy_redirect_to_login\"%' SINCE 1 hour ago LIMIT 50",
    )
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

  test('treats an exactly named container as seen', () => {
    const result = auditDiff(expected, [
      { namespace: 'ai-listings', container: 'ai-listings' },
      { namespace: 'supabase', container: 'supabase-kong' },
    ])
    expect(result.missing).toEqual([])
  })

  test('does not treat a container whose name is a prefix of the workload as seen', () => {
    const workloads = [{ namespace: 'ns', name: 'auth-proxy' }]
    expect(auditDiff(workloads, [{ namespace: 'ns', container: 'auth' }]).missing).toEqual(workloads)
  })

  test('does not treat a container prefixed by the workload name as seen', () => {
    const workloads = [{ namespace: 'ns', name: 'auth' }]
    expect(auditDiff(workloads, [{ namespace: 'ns', container: 'auth-proxy' }]).missing).toEqual(workloads)
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
})

describe('SINCE_PATTERN', () => {
  test.each(['', '0 hours', '01 hour', '1hour', ' 1 hour', '1 hour\n', '1 week', '1 HOUR', '-1 hour', '10000 days'])(
    'rejects %j',
    (value: string) => {
      expect(SINCE_PATTERN.test(value)).toBe(false)
    },
  )

  test.each(['1 hour', '1 hours', '15 minutes', '2 days'])('accepts %j', (value: string) => {
    expect(SINCE_PATTERN.test(value)).toBe(true)
  })
})
