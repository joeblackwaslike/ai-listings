import { SINCE_PATTERN } from './nrql'

interface K8sWorkload {
  metadata: { namespace: string; name: string }
  spec: {
    replicas?: number
    template: { spec: { containers: { name: string }[] } }
  }
}

export function expectedFromK8s(list: { items: K8sWorkload[] }): {
  namespace: string
  name: string
}[] {
  return list.items
    .filter((item) => (item.spec.replicas ?? 1) > 0)
    .flatMap((item) =>
      item.spec.template.spec.containers.map((container) => ({
        namespace: item.metadata.namespace,
        name: container.name,
      })),
    )
}

export function seenFromFacets(
  rows: { facet: (string | null)[] }[],
): { namespace: string; container: string }[] {
  return rows.flatMap(({ facet: [namespace, container] }) =>
    namespace && container ? [{ namespace, container }] : [],
  )
}

const KUBECTL_UNIT: Record<string, string> = { minute: 'm', hour: 'h', day: 'h' }

export function kubectlDuration(since: string): string {
  if (!SINCE_PATTERN.test(since)) {
    throw new Error(`invalid since "${since}": expected "<n> minutes|hours|days"`)
  }
  const [amount, unit] = since.split(' ')
  const singular = unit.replace(/s$/, '')
  const value = singular === 'day' ? Number(amount) * 24 : Number(amount)
  return `${value}${KUBECTL_UNIT[singular]}`
}

interface LineCount {
  namespace: string
  name: string
  lines?: number
  error?: string
}

export function classifyMissing(
  missing: { namespace: string; name: string }[],
  counts: LineCount[],
): {
  quiet: { namespace: string; name: string }[]
  dropped: { namespace: string; name: string; lines: number }[]
  unknown: { namespace: string; name: string; error: string }[]
} {
  const result = {
    quiet: [] as { namespace: string; name: string }[],
    dropped: [] as { namespace: string; name: string; lines: number }[],
    unknown: [] as { namespace: string; name: string; error: string }[],
  }
  for (const { namespace, name } of missing) {
    const count = counts.find((c) => c.namespace === namespace && c.name === name)
    if (count?.lines === undefined) {
      result.unknown.push({ namespace, name, error: count?.error ?? 'no kubectl result' })
    } else if (count.lines === 0) {
      result.quiet.push({ namespace, name })
    } else {
      result.dropped.push({ namespace, name, lines: count.lines })
    }
  }
  return result
}
