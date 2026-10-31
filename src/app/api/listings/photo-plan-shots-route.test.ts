import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
// Not co-located under `[id]/`: node's test runner treats `[id]` in a discovery path as a glob
// character class (see skip-bg-route.test.ts).
import { handleShotStatusPatch } from './[id]/photo-plan/shots/route'

interface StubOpts {
  listing: { id: string; user_id?: string } | null
  rpcResult?: { data: unknown; error: { message: string } | null }
}

function stubSupabase(opts: StubOpts) {
  const calls: { op: string; args?: unknown }[] = []
  const client = {
    from(table: string) {
      return {
        select: (_cols: string) => {
          calls.push({ op: `select:${table}` })
          const filters: Record<string, string> = {}
          const chain = {
            eq: (col: string, val: string) => ((filters[col] = val), chain),
            maybeSingle: async () => {
              const l = opts.listing
              const matches = l && filters.id === l.id && (l.user_id === undefined || filters.user_id === l.user_id)
              return { data: matches ? { id: l.id } : null, error: null }
            },
          }
          return chain
        },
      }
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ op: `rpc:${fn}`, args })
      return opts.rpcResult ?? { data: [], error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

function stubSession(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user } }) } }
}

const owned = { listing: { id: 'listing-1', user_id: 'user-1' } }

test('shots PATCH: unauthenticated request is rejected with 401 and touches nothing', async () => {
  const { client, calls } = stubSupabase(owned)
  const res = await handleShotStatusPatch(stubSession(null), client, 'listing-1', { shot: 'Front', status: 'taken' })
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test('shots PATCH: invalid bodies are rejected with 400 before any query', async () => {
  const bodies = [
    null,
    {},
    { shot: '', status: 'taken' },
    { shot: 'Front' },
    { shot: 'Front', status: 'verified' },
    { shot: 7, status: 'pending' },
  ]
  for (const body of bodies) {
    const { client, calls } = stubSupabase(owned)
    const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', body)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal(calls.length, 0)
  }
})

test('shots PATCH: a listing the user does not own is 404 and never reaches the rpc', async () => {
  const { client, calls } = stubSupabase({ listing: null })
  const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', { shot: 'Front', status: 'taken' })
  assert.equal(res.status, 404)
  assert.deepEqual(calls.map((c) => c.op), ['select:listings'])
})

test('shots PATCH: a listing owned by a different user is 404 and never reaches the rpc', async () => {
  const { client, calls } = stubSupabase({ listing: { id: 'listing-1', user_id: 'someone-else' } })
  const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', { shot: 'Front', status: 'taken' })
  assert.equal(res.status, 404)
  assert.deepEqual(calls.map((c) => c.op), ['select:listings'])
})

test('shots PATCH: success calls set_photo_shot_status and returns the updated plan', async () => {
  const plan = [{ shot: 'Front', description: 'front', required: true, photo_type: 'studio', status: 'taken' }]
  const { client, calls } = stubSupabase({ ...owned, rpcResult: { data: plan, error: null } })
  const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', { shot: 'Front', status: 'taken' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, photo_plan: plan })
  assert.deepEqual(calls[1], {
    op: 'rpc:set_photo_shot_status',
    args: { p_listing_id: 'listing-1', p_shot: 'Front', p_status: 'taken' },
  })
})

test('shots PATCH: a verified shot maps the rpc error to 409', async () => {
  const { client } = stubSupabase({
    ...owned,
    rpcResult: { data: null, error: { message: 'shot Front is verified and cannot change to pending' } },
  })
  const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', { shot: 'Front', status: 'pending' })
  assert.equal(res.status, 409)
})

test('shots PATCH: an unknown shot or vanished listing maps to 404, anything else to 500', async () => {
  const cases: [string, number][] = [
    ['shot not found: Back', 404],
    ['listing not found: listing-1', 404],
    ['connection reset', 500],
  ]
  for (const [message, status] of cases) {
    const { client } = stubSupabase({ ...owned, rpcResult: { data: null, error: { message } } })
    const res = await handleShotStatusPatch(stubSession({ id: 'user-1' }), client, 'listing-1', { shot: 'Back', status: 'taken' })
    assert.equal(res.status, status, message)
  }
})
