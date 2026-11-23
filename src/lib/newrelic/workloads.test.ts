// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { expectedFromK8s, seenFromFacets } from './workloads'

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

describe('seenFromFacets', () => {
  test('maps NerdGraph facet rows to namespace and container', () => {
    const rows = [{ facet: ['media', 'nzbget'], count: 5 }]
    expect(seenFromFacets(rows)).toEqual([{ namespace: 'media', container: 'nzbget' }])
  })

  test('drops rows with a null facet value', () => {
    expect(seenFromFacets([{ facet: ['media', null] }, { facet: [null, 'x'] }])).toEqual([])
  })
})
