import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBulkRestart } from './route'

// agent_blocked = true means a listing is deliberately held for human review (e.g. suspected
// counterfeit pending professional authentication) -- it is NOT a stuck/crashed pipeline run.
// Genuinely stalled/orphaned pipeline runs are recovered automatically by
// auto-recover-pipeline.ts's cron (find_stalled_resumable_listings, migration 0031),
// independent of agent_blocked. This endpoint used to select every agent_blocked=true row and
// re-fire its pipeline, which was one click away from bypassing a deliberate hold regardless of
// agent_blocked_reason. There is no other "failed" signal in this schema (ListingStatus has no
// failed/error state), so the only correct fix is that this route never queries listings by, or
// otherwise acts on, agent_blocked at all -- unblocking stays an explicit, individual, per-card
// action (ListingCard.tsx / StatusBadge.tsx's "Needs you" state).
//
// These tests exercise the handler's actual runtime behavior against a stub Supabase client
// (rather than checking the source text for banned substrings), so they still fail if the
// listings-querying/pipeline-firing behavior comes back under a renamed variable, an
// indirected helper, or an aliased import.

function stubSupabase(user: { id: string } | null) {
  const calls = { from: 0 }
  return {
    client: {
      auth: {
        getUser: async () => ({ data: { user } }),
      },
      from(...args: unknown[]) {
        calls.from += 1
        throw new Error(`unexpected listings query: from(${args.join(', ')})`)
      },
    },
    calls,
  }
}

test('bulk-restart: unauthenticated request is rejected with 401 and never queries listings', async () => {
  const { client, calls } = stubSupabase(null)

  const res = await handleBulkRestart(client)

  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'Unauthorized' })
  assert.equal(calls.from, 0)
})

test('bulk-restart: authenticated request is a no-op -- {restarted: 0}, no listings query', async () => {
  const { client, calls } = stubSupabase({ id: 'user-1' })

  const res = await handleBulkRestart(client)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { restarted: 0 })
  assert.equal(calls.from, 0)
})
