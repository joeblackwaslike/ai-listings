export type Action = 'create' | 'update' | 'noop' | 'refused' | 'orphan'

export interface DesiredResource {
  name: string
  spec: unknown
}

export interface ExistingResource extends DesiredResource {
  id: string
}

export interface PlanRow {
  kind: string
  name: string
  action: Action
  id?: string
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function planChanges(
  kind: string,
  desired: DesiredResource[],
  existing: ExistingResource[],
  options: { createOnly?: boolean } = {},
): PlanRow[] {
  return desired.map(({ name, spec }) => {
    const matches = existing.filter((resource) => resource.name === name)
    if (matches.length > 1) throw new Error(`${kind} "${name}" matches ${matches.length} existing resources`)
    const [match] = matches
    if (!match) return { kind, name, action: 'create' }
    const differs = canonical(match.spec) !== canonical(spec)
    const action = !differs ? 'noop' : options.createOnly ? 'refused' : 'update'
    return { kind, name, action, id: match.id }
  })
}

export function findOrphans(kind: string, desiredNames: string[], existing: ExistingResource[]): PlanRow[] {
  return existing
    .filter((resource) => !desiredNames.includes(resource.name))
    .map((resource) => ({ kind, name: resource.name, action: 'orphan', id: resource.id }))
}
