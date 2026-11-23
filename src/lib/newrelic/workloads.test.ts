// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { classifyMissing, expectedFromK8s, kubectlDuration, seenFromFacets, sumPodCounts } from './workloads'

function workload(
  namespace: string,
  name: string,
  replicas: number | undefined,
  containers: string[],
  initContainers: string[] = [],
) {
  return {
    metadata: { namespace, name },
    spec: {
      replicas,
      template: {
        spec: {
          containers: containers.map((c) => ({ name: c })),
          initContainers: initContainers.map((c) => ({ name: c })),
        },
      },
    },
  }
}

describe('expectedFromK8s', () => {
  test('emits one entry per container using the container name, not the deployment name', () => {
    const list = { items: [workload('ns', 'ai-listings-supabase-auth', 1, ['supabase-auth'])] }
    expect(expectedFromK8s(list)).toEqual([{ namespace: 'ns', name: 'supabase-auth' }])
  })

  test('skips workloads scaled to zero and init containers', () => {
    const list = {
      items: [
        workload('ns', 'off', 0, ['a']),
        workload('ns', 'on', 2, ['b', 'sidecar'], ['init']),
      ],
    }
    expect(expectedFromK8s(list)).toEqual([
      { namespace: 'ns', name: 'b' },
      { namespace: 'ns', name: 'sidecar' },
    ])
  })

  test('treats a missing replicas field as the default of one', () => {
    expect(expectedFromK8s({ items: [workload('ns', 'd', undefined, ['c'])] })).toEqual([
      { namespace: 'ns', name: 'c' },
    ])
  })
})

describe('expectedFromK8s dedupe', () => {
  test('yields one entry for two workloads sharing a namespace and container name', () => {
    const list = { items: [workload('ns', 'one', 1, ['app']), workload('ns', 'two', 1, ['app'])] }
    expect(expectedFromK8s(list)).toEqual([{ namespace: 'ns', name: 'app' }])
  })

  test('keeps the same container name in different namespaces', () => {
    const list = { items: [workload('a', 'one', 1, ['app']), workload('b', 'two', 1, ['app'])] }
    expect(expectedFromK8s(list)).toHaveLength(2)
  })
})

describe('seenFromFacets', () => {
  test('maps NerdGraph facet rows to namespace and container', () => {
    const rows = [{ facet: ['media', 'nzbget'], count: 5 }]
    expect(seenFromFacets(rows)).toEqual([{ namespace: 'media', container: 'nzbget' }])
  })

  test('drops rows with a null facet value', () => {
    expect(seenFromFacets([{ facet: ['media', null] }, { facet: [null, 'x'] }])).toEqual([])
  })
})

describe('kubectlDuration', () => {
  test('converts hours, minutes and days to kubectl durations', () => {
    expect(kubectlDuration('6 hours')).toBe('6h')
    expect(kubectlDuration('1 hour')).toBe('1h')
    expect(kubectlDuration('30 minutes')).toBe('30m')
    expect(kubectlDuration('2 days')).toBe('48h')
    expect(kubectlDuration('1 day')).toBe('24h')
    expect(kubectlDuration('1 minute')).toBe('1m')
  })

  test('rejects windows the logs query would reject', () => {
    expect(() => kubectlDuration('soon')).toThrow(/invalid since/)
  })
})

describe('classifyMissing', () => {
  const a = { namespace: 'ns', name: 'a' }
  const b = { namespace: 'ns', name: 'b' }
  const c = { namespace: 'ns', name: 'c' }

  test('splits missing containers into quiet, dropped and unknown', () => {
    const result = classifyMissing(
      [a, b, c],
      [
        { ...a, lines: 0 },
        { ...b, lines: 42 },
        { ...c, error: 'pods not found' },
      ],
    )
    expect(result.quiet).toEqual([a])
    expect(result.dropped).toEqual([{ ...b, lines: 42 }])
    expect(result.unknown).toEqual([{ ...c, error: 'pods not found' }])
  })

  test('reports a missing container with no line count as unknown', () => {
    expect(classifyMissing([a], []).unknown).toEqual([{ ...a, error: 'no kubectl result' }])
  })

  test('reports a container found in no pod as unknown even with zero lines', () => {
    expect(classifyMissing([a], [{ ...a, lines: 0, pods: 0 }]).unknown).toEqual([
      { ...a, error: 'no running pod with this container' },
    ])
  })

  test('reports a container with pods and zero lines as quiet', () => {
    expect(classifyMissing([a], [{ ...a, lines: 0, pods: 2 }]).quiet).toEqual([a])
  })
})

describe('sumPodCounts', () => {
  test('sums lines across pods that all succeeded', () => {
    expect(sumPodCounts([{ lines: 2 }, { lines: 3 }])).toEqual({ lines: 5, pods: 2 })
  })

  test('returns zero pods for an empty result list', () => {
    expect(sumPodCounts([])).toEqual({ lines: 0, pods: 0 })
  })

  test('returns the last error when every pod failed', () => {
    expect(sumPodCounts([{ error: 'a' }, { error: 'b' }])).toEqual({ error: 'b' })
  })

  test('returns an error instead of zero lines when some pods failed and the rest had no lines', () => {
    expect(sumPodCounts([{ lines: 0 }, { error: 'boom' }])).toEqual({ error: 'boom' })
  })

  test('keeps the line count when some pods failed but others had lines', () => {
    expect(sumPodCounts([{ lines: 4 }, { error: 'boom' }])).toEqual({ lines: 4, pods: 2 })
  })
})
