import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pipelineEndUpdate, blockedUpdate, unblockedUpdate } from '@/lib/pipeline/pipeline-end'

test('pipelineEndUpdate lands in in_loop, never condition_gate', () => {
  const u = pipelineEndUpdate(5)
  assert.deepEqual(u, {
    status: 'in_loop',
    condition_confirmed: false,
    pipeline_total: 5,
    agent_blocked: false,
    agent_blocked_reason: null,
    agent_blocked_kind: null,
  })
  assert.ok(!JSON.stringify(u).includes('condition_gate'))
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
