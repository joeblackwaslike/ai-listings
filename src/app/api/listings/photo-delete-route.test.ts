// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { test, expect, mock } from 'bun:test'

interface Op { table: string; op: string; patch?: unknown; filters: [string, unknown][] }
let ops: Op[] = []
let photoRow: Record<string, unknown> | null = null
let remainingStudio = 0

function builder(table: string, op: string, patch?: unknown) {
  const rec: Op = { table, op, patch, filters: [] }
  ops.push(rec)
  const b: Record<string, unknown> = {}
  b.eq = (c: string, v: unknown) => (rec.filters.push([c, v]), b)
  b.select = () => b
  b.single = async () => ({ data: photoRow, error: null })
  b.then = (res: (v: unknown) => unknown) =>
    Promise.resolve(op === 'count' ? { count: remainingStudio, error: null } : { error: null }).then(res)
  return b
}

const realServer = await import('@/lib/supabase/server')
mock.module('@/lib/supabase/server', () => ({
  ...realServer,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}))
const realPush = await import('@/lib/pipeline/supabase-push')
mock.module('@/lib/pipeline/supabase-push', () => ({
  ...realPush,
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (_c: string, opts?: unknown) => builder(table, opts ? 'count' : 'select'),
      delete: () => builder(table, 'delete'),
      update: (patch: unknown) => builder(table, 'update', patch),
    }),
  }),
}))

const { DELETE } = await import('../photos/[id]/route')
const ctx = { params: Promise.resolve({ id: 'p1' }) }

function setup(type: string, status: string, studioLeft: number) {
  ops = []
  photoRow = { id: 'p1', listing_id: 'l1', type, listings: { user_id: 'u1', status } }
  remainingStudio = studioLeft
}
const listingUpdate = () => ops.find((o) => o.table === 'listings' && o.op === 'update')

test('deleting the last studio photo unconfirms photos and condition', async () => {
  setup('studio', 'in_loop', 0)
  const res = await DELETE(new Request('http://x'), ctx)
  expect(res.status).toBe(200)
  expect(listingUpdate()?.patch).toEqual({ photos_confirmed: false, condition_confirmed: false })
})

test('deleting a studio photo while others remain leaves confirmation alone', async () => {
  setup('studio', 'in_loop', 2)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})

test('a published listing keeps its confirmations', async () => {
  setup('studio', 'published', 0)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})

test('deleting a non-studio photo never touches confirmations', async () => {
  setup('auth_card', 'in_loop', 0)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})
