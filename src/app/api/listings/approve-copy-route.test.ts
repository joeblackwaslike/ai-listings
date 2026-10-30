import { test, expect, mock } from 'bun:test'

interface Call { op: string; patch?: unknown; filters: [string, unknown][] }
let calls: Call[] = []
let results: Record<string, { data?: unknown; error?: unknown }> = {}

function builder(op: string, patch?: unknown) {
  const call: Call = { op, patch, filters: [] }
  calls.push(call)
  const b: Record<string, unknown> = {}
  b.eq = (c: string, v: unknown) => (call.filters.push([c, v]), b)
  b.select = () => b
  const settle = () => {
    const key = call.filters.some(([c]) => c === 'agent_blocked_kind') ? 'unblock' : op
    return Promise.resolve({ data: null, error: null, ...results[key] })
  }
  b.maybeSingle = settle
  b.then = (res: (v: unknown) => unknown) => settle().then(res)
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
    from: () => ({
      select: () => builder('owner'),
      update: (patch: unknown) => builder('update', patch),
    }),
  }),
}))

const { PATCH } = await import('./[id]/approve-copy/route')
const ctx = { params: Promise.resolve({ id: 'l1' }) }

function setup(r: typeof results) {
  calls = []
  results = { owner: { data: { id: 'l1' } }, update: { data: { id: 'l1' } }, ...r }
}

test('approve-copy: a failed rewrite_failed unblock returns 500 before the status flips', async () => {
  setup({ unblock: { error: { message: 'boom' } } })
  const res = await PATCH(new Request('http://x'), ctx)
  expect(res.status).toBe(500)
  expect(calls.some((c) => (c.patch as { status?: string })?.status === 'in_loop')).toBe(false)
})

test('approve-copy: success unblocks then flips status', async () => {
  setup({})
  const res = await PATCH(new Request('http://x'), ctx)
  expect(res.status).toBe(200)
  const updates = calls.filter((c) => c.op === 'update')
  expect(updates[0].filters).toContainEqual(['agent_blocked_kind', 'rewrite_failed'])
  expect((updates[1].patch as { status: string }).status).toBe('in_loop')
})
