// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { test, expect, mock } from 'bun:test'

interface Op { table: string; op: string; patch?: unknown; filters: [string, unknown][] }
let ops: Op[] = []
let photoRow: Record<string, unknown> | null = null
let studioCount = 0
let resetError: { message: string } | null = null

function builder(table: string, op: string, patch?: unknown) {
  const rec: Op = { table, op, patch, filters: [] }
  ops.push(rec)
  const b: Record<string, unknown> = {}
  b.eq = (c: string, v: unknown) => (rec.filters.push([c, v]), b)
  b.select = () => b
  b.single = async () => ({ data: photoRow, error: null })
  b.then = (res: (v: unknown) => unknown) =>
    Promise.resolve(
      op === 'count' ? { count: studioCount, error: null } : { error: op === 'update' ? resetError : null }
    ).then(res)
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

function setup(type: string, status: string, studioTotal: number) {
  ops = []
  resetError = null
  photoRow = { id: 'p1', listing_id: 'l1', type, listings: { user_id: 'u1', status } }
  studioCount = studioTotal
}
const listingUpdate = () => ops.find((o) => o.table === 'listings' && o.op === 'update')

test('deleting the last studio photo unconfirms photos and condition', async () => {
  setup('studio', 'in_loop', 1)
  const res = await DELETE(new Request('http://x'), ctx)
  expect(res.status).toBe(200)
  expect(listingUpdate()?.patch).toEqual({ photos_confirmed: false, condition_confirmed: false })
})

test('the confirmation reset runs before the photo is deleted', async () => {
  setup('studio', 'in_loop', 1)
  await DELETE(new Request('http://x'), ctx)
  const order = ops.filter((o) => o.op === 'update' || o.op === 'delete').map((o) => o.op)
  expect(order).toEqual(['update', 'delete'])
})

test('a failed reset returns 500 and leaves the photo undeleted', async () => {
  setup('studio', 'in_loop', 1)
  resetError = { message: 'boom' }
  const res = await DELETE(new Request('http://x'), ctx)
  expect(res.status).toBe(500)
  expect(ops.some((o) => o.op === 'delete')).toBe(false)
})

test('deleting a studio photo while others remain leaves confirmation alone', async () => {
  setup('studio', 'in_loop', 3)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})

test('a published listing keeps its confirmations', async () => {
  setup('studio', 'published', 1)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})

test('deleting a non-studio photo never touches confirmations', async () => {
  setup('auth_card', 'in_loop', 1)
  await DELETE(new Request('http://x'), ctx)
  expect(listingUpdate()).toBeUndefined()
})
