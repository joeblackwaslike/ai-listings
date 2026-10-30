// @ts-ignore bun:test has no type declarations installed (@types/bun absent)
import { test, expect, mock, spyOn } from 'bun:test'

let updateFilters: [string, unknown][] = []
let updateResult: unknown = { id: 'l1' }

function builder(isUpdate: boolean) {
  const b: Record<string, unknown> = {}
  const filters: [string, unknown][] = []
  if (isUpdate && updateFilters.length === 0) updateFilters = filters
  b.eq = (c: string, v: unknown) => (filters.push([c, v]), b)
  b.select = () => b
  b.maybeSingle = async () =>
    isUpdate
      ? { data: updateResult, error: null }
      : { data: { condition: null, condition_notes: null, condition_confirmed: false, photos_confirmed: true }, error: null }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
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
  getSupabaseAdmin: () => ({ from: () => ({ select: () => builder(false), update: () => builder(true) }) }),
}))
const { inngest } = await import('@/lib/inngest/client')
spyOn(inngest, 'send').mockResolvedValue({ ids: [] })

const { PATCH } = await import('./[id]/confirm-condition/route')
const ctx = { params: Promise.resolve({ id: 'l1' }) }
const req = () =>
  new Request('http://x', {
    method: 'PATCH',
    body: JSON.stringify({ condition: 'good', condition_notes: '', extra_notes: '' }),
  })

test('confirm-condition: the CAS update also requires photos_confirmed = true', async () => {
  updateFilters = []
  const res = await PATCH(req(), ctx)
  expect(res.status).toBe(200)
  expect(updateFilters).toContainEqual(['photos_confirmed', true])
})

test('confirm-condition: a lost CAS (photos reverted concurrently) is a 409', async () => {
  updateFilters = []
  updateResult = null
  const res = await PATCH(req(), ctx)
  expect(res.status).toBe(409)
  updateResult = { id: 'l1' }
})
