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
