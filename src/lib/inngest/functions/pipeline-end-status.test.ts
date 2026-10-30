import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pipelineEndUpdate,
  blockedUpdate,
  unblockedUpdate,
  pipelineSettled,
  finishPipeline,
} from '@/lib/pipeline/pipeline-end'

test('pipelineEndUpdate lands in in_loop while the photos are unconfirmed', () => {
  assert.deepEqual(pipelineEndUpdate(5, false), {
    status: 'in_loop',
    condition_confirmed: false,
    pipeline_total: 5,
  })
})

test('pipelineEndUpdate goes to condition review when the photos are already confirmed', () => {
  assert.deepEqual(pipelineEndUpdate(4, true), {
    status: 'condition_gate',
    condition_confirmed: false,
    pipeline_total: 4,
  })
})

test('pipelineEndUpdate never touches the blocked fields', () => {
  for (const photosConfirmed of [false, true]) {
    const u = pipelineEndUpdate(5, photosConfirmed)
    assert.ok(!('agent_blocked' in u) && !('agent_blocked_kind' in u) && !('agent_blocked_reason' in u))
  }
})

test('blockedUpdate sets blocked, reason, and kind', () => {
  assert.deepEqual(blockedUpdate('rewrite_failed', 'x'), {
    agent_blocked: true,
    agent_blocked_reason: 'x',
    agent_blocked_kind: 'rewrite_failed',
  })
})

test('unblockedUpdate nulls reason and kind', () => {
  assert.deepEqual(unblockedUpdate(), {
    agent_blocked: false,
    agent_blocked_reason: null,
    agent_blocked_kind: null,
  })
})

test('pipelineSettled is false while steps remain or the listing waits at a pre-photo gate or has shipped/archived', () => {
  assert.equal(pipelineSettled({ status: 'in_loop', pipeline_step: 3, pipeline_total: 5 }), false)
  for (const status of ['intake', 'id_gate', 'gender_gate', 'published', 'sold', 'archived'] as const) {
    assert.equal(pipelineSettled({ status, pipeline_step: 5, pipeline_total: 5 }), false, status)
  }
})

test('pipelineSettled is true once every step ran and the listing left the pre-photo gates', () => {
  assert.equal(pipelineSettled({ status: 'in_loop', pipeline_step: 4, pipeline_total: 4 }), true)
  assert.equal(pipelineSettled({ status: 'condition_gate', pipeline_step: 5, pipeline_total: 4 }), true)
})

function recordingClient() {
  const writes: { update: Record<string, unknown>; filters: string[] }[] = []
  const client = {
    from(table: string) {
      assert.equal(table, 'listings')
      return {
        update(update: Record<string, unknown>) {
          const write = { update, filters: [] as string[] }
          writes.push(write)
          const chain = {
            eq: (col: string, val: unknown) => { write.filters.push(`${col}=${String(val)}`); return chain },
            neq: (col: string, val: unknown) => { write.filters.push(`${col}!=${String(val)}`); return chain },
            then: (resolve: (r: { error: null }) => void) => resolve({ error: null }),
          }
          return chain
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, writes }
}

test('finishPipeline writes the unconfirmed-photos landing first, then the confirmed one', async () => {
  const { client, writes } = recordingClient()
  await finishPipeline(client, 'l1', 5)
  assert.deepEqual(writes[0], {
    update: pipelineEndUpdate(5, false),
    filters: ['id=l1', 'photos_confirmed=false', 'status!=archived'],
  })
  assert.deepEqual(writes[1], {
    update: pipelineEndUpdate(5, true),
    filters: ['id=l1', 'photos_confirmed=true', 'status!=archived'],
  })
})

test('finishPipeline clears only an intake_failed block, never a photo_quality one', async () => {
  const { client, writes } = recordingClient()
  await finishPipeline(client, 'l1', 4)
  const unblocks = writes.filter((w) => w.update.agent_blocked === false)
  assert.equal(unblocks.length, 1)
  assert.deepEqual(unblocks[0], {
    update: unblockedUpdate(),
    filters: ['id=l1', 'agent_blocked_kind=intake_failed'],
  })
  assert.equal(writes.length, 3)
})
