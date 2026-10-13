import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canConfirmCondition, canFinalizeOrPublish } from './publish-gate'

const ok = {
  photos_confirmed: true,
  condition_confirmed: true,
  inclusions: [{ item: 'box', confirmed: true }],
  copy_approved_at: '2026-10-13T00:00:00Z',
  status: 'finalizing',
} as unknown as Parameters<typeof canFinalizeOrPublish>[0]
const studio = { type: 'studio', photoroom_meta: null } as Parameters<typeof canFinalizeOrPublish>[1][number]

test('canConfirmCondition is false without confirmed photos', () => {
  const r = canConfirmCondition({ photos_confirmed: false })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /photos/i)
  assert.deepEqual(canConfirmCondition({ photos_confirmed: true }), { ok: true })
})

test('publish gate rejects unconfirmed photos', () => {
  const r = canFinalizeOrPublish({ ...ok, photos_confirmed: false }, [studio])
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /photos/i)
})

test('publish gate rejects missing copy approval', () => {
  assert.equal(canFinalizeOrPublish({ ...ok, copy_approved_at: null }, [studio]).ok, false)
})

test('publish gate rejects unconfirmed inclusion or condition', () => {
  const inclusions = [{ item: 'box', confirmed: false }] as unknown as typeof ok.inclusions
  assert.equal(canFinalizeOrPublish({ ...ok, inclusions }, [studio]).ok, false)
  assert.equal(canFinalizeOrPublish({ ...ok, condition_confirmed: false }, [studio]).ok, false)
})

test('publish gate rejects quality_failed studio photo', () => {
  const bad = { type: 'studio', photoroom_meta: { quality_failed: true } } as unknown as typeof studio
  assert.equal(canFinalizeOrPublish(ok, [studio, bad]).ok, false)
})

test('publish gate rejects unexpected status', () => {
  assert.equal(canFinalizeOrPublish({ ...ok, status: 'copy_review' }, [studio]).ok, false)
  assert.equal(canFinalizeOrPublish({ ...ok, status: 'archived' }, [studio]).ok, false)
})

test('publish gate passes when everything is satisfied', () => {
  for (const status of ['in_loop', 'finalizing', 'published'] as const) {
    assert.deepEqual(canFinalizeOrPublish({ ...ok, status }, [studio]), { ok: true })
  }
})

test('already-shipped listings skip photo, copy and quality checks', () => {
  const bad = { type: 'studio', photoroom_meta: { quality_failed: true } } as unknown as typeof studio
  for (const status of ['published', 'sold'] as const) {
    const legacy = { ...ok, status, photos_confirmed: false, copy_approved_at: null }
    assert.deepEqual(canFinalizeOrPublish(legacy, [bad]), { ok: true })
    assert.equal(canFinalizeOrPublish({ ...legacy, condition_confirmed: false }, []).ok, false)
  }
})
