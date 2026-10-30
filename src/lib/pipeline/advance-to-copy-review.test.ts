import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { advanceToCopyReview, clearCopyApproval, rewriteFailureScope, saveRewrittenCopy } from './advance-to-copy-review'

function fakeSupabase(row: Record<string, unknown> | null) {
  const filters: Array<[string, unknown]> = []
  const builder: Record<string, unknown> = {
    update: () => builder,
    eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
    in: (col: string, val: unknown) => (filters.push([col, val]), builder),
    select: () => builder,
    maybeSingle: async () => {
      const matches = filters.every(([col, val]) =>
        Array.isArray(val) ? val.includes(row?.[col]) : row?.[col] === val,
      )
      return { data: row && matches ? { id: row.id } : null, error: null }
    },
  }
  return { from: () => builder } as unknown as SupabaseClient
}

test('advances when condition is still confirmed', async () => {
  const db = fakeSupabase({ id: 'a', status: 'condition_gate', condition_confirmed: true })
  assert.equal(await advanceToCopyReview(db, 'a'), true)
})

test('matches no row when condition reassessment reset condition_confirmed', async () => {
  const db = fakeSupabase({ id: 'a', status: 'condition_gate', condition_confirmed: false })
  assert.equal(await advanceToCopyReview(db, 'a'), false)
})

test('clearCopyApproval clears approval and reports true while the listing is in a rewrite entry status', async () => {
  for (const status of ['condition_gate', 'copy_review', 'in_loop']) {
    assert.equal(await clearCopyApproval(fakeSupabase({ id: 'a', status }), 'a'), true, status)
  }
})

test('clearCopyApproval reports false and skips listings that already moved on', async () => {
  for (const status of ['finalizing', 'published', 'sold', 'archived']) {
    assert.equal(await clearCopyApproval(fakeSupabase({ id: 'a', status }), 'a'), false, status)
  }
})

test('rewriteFailureScope: a rewrite request also fails out of in_loop and drops approval', () => {
  const rewrite = rewriteFailureScope('listing/rewrite-requested')
  assert.equal(rewrite.revertStatus, 'copy_review')
  assert.deepEqual(rewrite.fromStatuses, ['copy_review', 'in_loop'])
  assert.deepEqual(rewrite.extraUpdate, { copy_approved_at: null })
  const first = rewriteFailureScope('listing/condition-confirmed')
  assert.equal(first.revertStatus, 'condition_gate')
  assert.deepEqual(first.fromStatuses, ['condition_gate'])
  assert.deepEqual(first.extraUpdate, { condition_confirmed: false })
})

function fakeSaveSupabase(row: Record<string, unknown> | null) {
  const written: Array<Record<string, unknown>> = []
  const from = () => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const builder: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => ((patch = p), builder),
      select: () => builder,
      eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
      in: (col: string, val: unknown) => (filters.push([col, val]), builder),
      maybeSingle: async () => {
        const matches = filters.every(([col, val]) =>
          Array.isArray(val) ? val.includes(row?.[col]) : row?.[col] === val,
        )
        if (patch && row && matches) written.push(patch)
        return { data: row && matches ? { id: row.id, status: row.status } : null, error: null }
      },
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, written }
}

test('saveRewrittenCopy writes the new copy while the listing is still before finalize', async () => {
  for (const status of ['condition_gate', 'copy_review', 'in_loop']) {
    const { db, written } = fakeSaveSupabase({ id: 'a', status })
    assert.equal(await saveRewrittenCopy(db, 'a', { title: 'new' }), true, status)
    assert.deepEqual(written, [{ title: 'new', copy_approved_at: null }])
  }
})

test('saveRewrittenCopy leaves the approved copy alone once the listing moved to finalizing or shipped', async () => {
  for (const status of ['finalizing', 'published', 'sold']) {
    const { db, written } = fakeSaveSupabase({ id: 'a', status })
    assert.equal(await saveRewrittenCopy(db, 'a', { title: 'new' }), false, status)
    assert.deepEqual(written, [], status)
  }
})

test('saveRewrittenCopy throws for a status that should never be rewriting so the dropped copy is not silent', async () => {
  for (const status of ['intake', 'id_gate', 'gender_gate']) {
    await assert.rejects(saveRewrittenCopy(fakeSaveSupabase({ id: 'a', status }).db, 'a', {}), new RegExp(`unexpected status ${status}`), status)
  }
})

test('saveRewrittenCopy throws for an archived or missing listing so Inngest retries', async () => {
  await assert.rejects(saveRewrittenCopy(fakeSaveSupabase({ id: 'a', status: 'archived' }).db, 'a', {}), /archived or deleted/)
  await assert.rejects(saveRewrittenCopy(fakeSaveSupabase(null).db, 'a', {}), /archived or deleted/)
})
