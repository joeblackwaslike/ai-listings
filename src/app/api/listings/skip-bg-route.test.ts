import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
// Deliberately not co-located with route.ts (which lives under the `[id]` dynamic segment) --
// node's built-in test runner treats `[id]` in a file path as a glob character class, so
// `npm test`'s `find src -name '*.test.ts' | node --test` would silently discover and match
// zero tests for anything placed inside a bracketed route directory, with no error and exit
// code 0. Importing the handler from one level up avoids the CLI arg entirely; only the module
// specifier (not the test-file discovery path) contains the bracket.
import { handleSkipBg } from './[id]/skip-bg/route'
import type { ApiKeys } from '@/lib/user-api-keys'

// Toggling skip_background_removal here only ever flips the listings row -- it never re-ran
// the intake pipeline's photo processing. A listing that was already background-removed (or
// already crop/denoise-only processed) before the toggle keeps whatever processed_url that
// earlier pass produced, so every consumer (PhotoPanel, PhotoSection, ListingCard) kept
// showing the stale variant instead of the one matching the flag the user just set. These
// tests exercise handleSkipBg's actual reprocessing decision against a stub Supabase client,
// not just its DB write.

const apiKeys = {} as ApiKeys

interface StubOpts {
  listing: { user_id: string; skip_background_removal: boolean } | null
  photo?: { id: string; raw_url: string; processed_url: string | null } | null
  updateError?: { message: string } | null
}

function stubSupabase(opts: StubOpts) {
  const calls: { table: string; op: string }[] = []

  function from(table: string) {
    return {
      select: (_cols: string) => {
        calls.push({ table, op: 'select' })
        const chain = {
          eq: (_col: string, _val: string) => chain,
          single: async () => ({ data: table === 'listings' ? opts.listing : null, error: null }),
          maybeSingle: async () => ({ data: table === 'photos' ? (opts.photo ?? null) : null, error: null }),
        }
        return chain
      },
      update: (_vals: Record<string, unknown>) => {
        calls.push({ table, op: 'update' })
        return {
          eq: async (_col: string, _val: string) => ({ error: opts.updateError ?? null }),
        }
      },
    }
  }

  return { client: { from } as unknown as SupabaseClient, calls }
}

function stubSession(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user } }) } }
}

test('handleSkipBg: unauthenticated request is rejected with 401 and never queries the listing', async () => {
  const { client, calls } = stubSupabase({ listing: null })

  const res = await handleSkipBg(stubSession(null), client, 'listing-1', true)

  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'Unauthorized' })
  assert.equal(calls.length, 0)
})

test('handleSkipBg: a listing owned by a different user is rejected with 404 and never reaches photos', async () => {
  const { client, calls } = stubSupabase({ listing: { user_id: 'other-user', skip_background_removal: false } })

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', true)

  assert.equal(res.status, 404)
  assert.deepEqual(calls, [{ table: 'listings', op: 'select' }])
})

test('handleSkipBg: turning skip ON reprocesses a previously bg-removed photo via processRaw, not removeBg', async () => {
  const { client } = stubSupabase({
    listing: { user_id: 'user-1', skip_background_removal: false },
    photo: { id: 'photo-1', raw_url: 'https://x/raw.jpg', processed_url: 'https://x/bg-removed.jpg' },
  })
  const calls: string[] = []

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', true, {
    processRaw: async (photoId, _url, storagePath) => {
      calls.push(`processRaw:${photoId}:${storagePath}`)
    },
    removeBg: async () => {
      calls.push('removeBg')
    },
  })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, skip: true })
  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /^processRaw:photo-1:intake\/listing-1\/processed-photo-1\.png$/)
})

test('handleSkipBg: turning skip OFF reprocesses a previously raw-processed photo via removeBg, not processRaw', async () => {
  const { client } = stubSupabase({
    listing: { user_id: 'user-1', skip_background_removal: true },
    photo: { id: 'photo-1', raw_url: 'https://x/raw.jpg', processed_url: 'https://x/crop-denoise-only.jpg' },
  })
  const calls: string[] = []

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', false, {
    processRaw: async () => {
      calls.push('processRaw')
    },
    removeBg: async (photoId, _url, storagePath) => {
      calls.push(`removeBg:${photoId}:${storagePath}`)
    },
    getApiKeys: async () => apiKeys,
  })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, skip: false })
  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /^removeBg:photo-1:intake\/listing-1\/processed-photo-1\.png$/)
})

test('handleSkipBg: no-op toggle (requested skip matches current flag) never touches photos or reprocesses', async () => {
  const { client, calls: dbCalls } = stubSupabase({
    listing: { user_id: 'user-1', skip_background_removal: true },
    photo: { id: 'photo-1', raw_url: 'https://x/raw.jpg', processed_url: 'https://x/crop-denoise-only.jpg' },
  })
  const reprocessCalls: string[] = []

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', true, {
    processRaw: async () => {
      reprocessCalls.push('processRaw')
    },
    removeBg: async () => {
      reprocessCalls.push('removeBg')
    },
  })

  assert.equal(res.status, 200)
  assert.equal(reprocessCalls.length, 0)
  assert.ok(!dbCalls.some((c) => c.table === 'photos'), 'photos table should never be queried on a no-op toggle')
})

test('handleSkipBg: a listing with no processed_url yet (still mid-pipeline) skips reprocessing but still flips the flag', async () => {
  const { client } = stubSupabase({
    listing: { user_id: 'user-1', skip_background_removal: false },
    photo: { id: 'photo-1', raw_url: 'https://x/raw.jpg', processed_url: null },
  })
  const reprocessCalls: string[] = []

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', true, {
    processRaw: async () => {
      reprocessCalls.push('processRaw')
    },
    removeBg: async () => {
      reprocessCalls.push('removeBg')
    },
  })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, skip: true })
  assert.equal(reprocessCalls.length, 0)
})

test('handleSkipBg: a reprocessing failure returns 500 and does not persist the flag flip', async () => {
  const { client, calls: dbCalls } = stubSupabase({
    listing: { user_id: 'user-1', skip_background_removal: false },
    photo: { id: 'photo-1', raw_url: 'https://x/raw.jpg', processed_url: 'https://x/bg-removed.jpg' },
  })

  const res = await handleSkipBg(stubSession({ id: 'user-1' }), client, 'listing-1', true, {
    processRaw: async () => {
      throw new Error('storage upload failed')
    },
  })

  assert.equal(res.status, 500)
  assert.deepEqual(await res.json(), { error: 'Failed to reprocess photo' })
  assert.ok(!dbCalls.some((c) => c.table === 'listings' && c.op === 'update'), 'flag must not flip when reprocessing fails')
})
