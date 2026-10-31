// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { test, expect, mock } from 'bun:test'

let updates: unknown[] = []
let sendError: Error | null = null

function builder(table: string, patch?: unknown) {
  const b: Record<string, unknown> = {}
  b.eq = () => b
  b.select = () => b
  b.single = async () =>
    table === 'photos'
      ? { data: { id: 'p1', listing_id: 'l1', raw_url: 'raw', processed_url: null }, error: null }
      : { data: { user_id: 'u1' }, error: null }
  b.then = (res: (v: unknown) => unknown) => (updates.push(patch), Promise.resolve({ error: null }).then(res))
  return b
}

const realServer = await import('@/lib/supabase/server')
mock.module('@/lib/supabase/server', () => ({
  ...realServer,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}))
const realSupabase = await import('@supabase/supabase-js')
mock.module('@supabase/supabase-js', () => ({
  ...realSupabase,
  createClient: () => ({
    from: (table: string) => ({
      select: () => builder(table),
      update: (patch: unknown) => builder(table, patch),
    }),
  }),
}))
const realInngest = await import('@/lib/inngest/client')
mock.module('@/lib/inngest/client', () => ({
  ...realInngest,
  inngest: {
    send: async () => {
      if (sendError) throw sendError
    },
  },
}))

const { POST } = await import('../photos/[id]/bg-removal/route')
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const skip = () => new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'skip' }) })

test('bg-removal skip: write ok and readiness event queued returns 200', async () => {
  updates = []
  sendError = null
  const res = await POST(skip(), ctx)
  expect(res.status).toBe(200)
  expect(updates).toEqual([{ processed_url: 'raw' }])
})

test('bg-removal skip: write ok but readiness event fails returns an actionable 502', async () => {
  updates = []
  sendError = new Error('inngest down')
  const res = await POST(skip(), ctx)
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'Photo saved, but the readiness check could not be queued. Try again.' })
  expect(updates).toEqual([{ processed_url: 'raw' }])
})
