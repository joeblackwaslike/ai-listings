import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

export interface RecordedWrite {
  table: string
  op: 'insert' | 'update' | 'delete'
  values?: Row
  affected: number
}

export interface FakeSupabase {
  client: SupabaseClient
  tables: Record<string, Row[]>
  writes: RecordedWrite[]
  effectiveWrites: () => RecordedWrite[]
}

export function fakeSupabase(tables: Record<string, Row[]>, user: { id: string } | null = null): FakeSupabase {
  const writes: RecordedWrite[] = []

  function from(table: string) {
    const rows = (tables[table] ??= [])
    const filters: Array<[string, unknown]> = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let values: Row | undefined

    const matching = () =>
      rows.filter((r) => filters.every(([col, val]) => (Array.isArray(val) ? val.includes(r[col]) : r[col] === val)))

    const run = (): Row[] => {
      if (op === 'select') return matching()
      if (op === 'insert') {
        const row = { id: `${table}-${rows.length + 1}`, ...values }
        rows.push(row)
        writes.push({ table, op, values, affected: 1 })
        return [row]
      }
      const hit = matching()
      if (op === 'update') hit.forEach((r) => Object.assign(r, values))
      if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1))
      writes.push({ table, op, values, affected: hit.length })
      return hit
    }

    const chain = {
      select: () => chain,
      insert: (v: Row) => {
        op = 'insert'
        values = v
        return chain
      },
      update: (v: Row) => {
        op = 'update'
        values = v
        return chain
      },
      delete: () => {
        op = 'delete'
        return chain
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return chain
      },
      in: (col: string, val: unknown[]) => {
        filters.push([col, val])
        return chain
      },
      single: async () => {
        const hit = run()[0]
        return hit ? { data: hit, error: null } : { data: null, error: { message: 'no rows' } }
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    }
    return chain
  }

  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from,
  } as unknown as SupabaseClient

  return { client, tables, writes, effectiveWrites: () => writes.filter((w) => w.affected > 0) }
}
