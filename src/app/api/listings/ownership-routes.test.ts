import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase } from '@/lib/test/fake-supabase'
import { handleArchive } from './[id]/archive/route'
import { handleAuthPlan } from './[id]/auth-plan/route'
import { handlePublish } from './[id]/publish/route'
import { handleFinalize } from './[id]/finalize/route'
import { handleAddComp, handleDeleteComp } from './[id]/comps/route'

// Not co-located with the routes: see skip-bg-route.test.ts for why bracketed dirs hide tests.
// A non-owner must get 404 and the admin client must never change a row.

const OWNER = { id: 'owner' }
const INTRUDER = { id: 'intruder' }
const COMP_ID = '11111111-1111-4111-8111-111111111111'

function world() {
  return {
    listings: [
      {
        id: 'l1',
        user_id: 'owner',
        status: 'in_loop',
        photos_confirmed: true,
        condition_confirmed: true,
        copy_approved_at: '2026-01-01',
        inclusions: [],
        listing_urls: null,
        platform_fields: null,
        auth_plan: null,
      },
    ],
    photos: [{ id: 'p1', listing_id: 'l1', type: 'studio', photoroom_meta: null }],
  }
}

function setup(user: { id: string } | null) {
  const session = fakeSupabase({}, user)
  const admin = fakeSupabase(world())
  return { session: session.client, admin, row: admin.tables.listings![0]! }
}

const json = (body: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) })

const routes = [
  ['archive', (s: ReturnType<typeof setup>) => handleArchive(s.session, s.admin.client, 'l1'), 'status', 'archived'],
  [
    'auth-plan',
    (s: ReturnType<typeof setup>) => handleAuthPlan(s.session, s.admin.client, 'l1', json({ auth_plan: [{ step: 1 }] })),
    'auth_plan',
    [{ step: 1 }],
  ],
  [
    'publish',
    (s: ReturnType<typeof setup>) => handlePublish(s.session, s.admin.client, 'l1', json({ mark_published: true })),
    'status',
    'published',
  ],
  ['finalize', (s: ReturnType<typeof setup>) => handleFinalize(s.session, s.admin.client, 'l1'), 'status', 'finalizing'],
] as const

for (const [name, call, field, expected] of routes) {
  test(`${name}: unauthenticated gets 401 and nothing is written`, async () => {
    const s = setup(null)
    const res = await call(s)
    assert.equal(res.status, 401)
    assert.deepEqual(s.admin.effectiveWrites(), [])
  })

  test(`${name}: non-owner gets 404 and the row is untouched`, async () => {
    const s = setup(INTRUDER)
    const before = structuredClone(s.row)
    const res = await call(s)
    assert.equal(res.status, 404)
    assert.deepEqual(s.admin.effectiveWrites(), [])
    assert.deepEqual(s.row, before)
  })

  test(`${name}: owner succeeds and the row changes`, async () => {
    const s = setup(OWNER)
    const res = await call(s)
    assert.equal(res.status, 200)
    assert.deepEqual(s.row[field], expected)
  })
}

function compsSetup(user: { id: string } | null, owns: boolean) {
  const fake = fakeSupabase(
    {
      listings: owns ? [{ id: 'l1', user_id: 'owner' }] : [],
      pricing_comps: [{ id: COMP_ID, listing_id: 'l1', source: 'manual' }],
    },
    user
  )
  return { fake, recalcCalls: [] as string[] }
}

const recalc = (calls: string[]) => async (id: string) => {
  calls.push(id)
  return {} as Awaited<ReturnType<typeof import('@/lib/pipeline/step3-pricing-research').recalculateListingPrice>>
}
const addReq = () =>
  new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 't', salePriceCents: 500 }) })
const delReq = () => new Request('http://x', { method: 'DELETE', body: JSON.stringify({ compId: COMP_ID }) })

for (const [name, handler, req] of [
  ['comps POST', handleAddComp, addReq],
  ['comps DELETE', handleDeleteComp, delReq],
] as const) {
  test(`${name}: unauthenticated gets 401 and nothing is written`, async () => {
    const { fake, recalcCalls } = compsSetup(null, true)
    const res = await handler(fake.client, 'l1', req(), recalc(recalcCalls))
    assert.equal(res.status, 401)
    assert.deepEqual(fake.writes, [])
    assert.deepEqual(recalcCalls, [])
  })

  test(`${name}: non-owner gets 404 and nothing is written or recalculated`, async () => {
    const { fake, recalcCalls } = compsSetup(INTRUDER, false)
    const res = await handler(fake.client, 'l1', req(), recalc(recalcCalls))
    assert.equal(res.status, 404)
    assert.deepEqual(fake.writes, [])
    assert.deepEqual(recalcCalls, [])
  })

  test(`${name}: owner succeeds`, async () => {
    const { fake, recalcCalls } = compsSetup(OWNER, true)
    const res = await handler(fake.client, 'l1', req(), recalc(recalcCalls))
    assert.equal(res.status, 200)
    assert.equal(fake.effectiveWrites().length, 1)
    assert.deepEqual(recalcCalls, ['l1'])
  })
}
