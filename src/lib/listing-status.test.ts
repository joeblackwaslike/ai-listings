import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getStatusBadge, getBadgeContext, PUBLISH_PLATFORMS, BADGE_TONE_CLASSES, type BadgeListing } from './listing-status'

const base: BadgeListing = {
  status: 'in_loop',
  pipeline_step: 5,
  pipeline_total: 5,
  agent_blocked: false,
  agent_blocked_kind: null,
  copy_approved_at: null,
  listing_urls: {},
  gender: null,
}
const ctx = { hasStudioPhotos: true, needsGender: false, needsMeasurements: false }
const badge = (l: Partial<BadgeListing>, c: Partial<typeof ctx> = {}) =>
  getStatusBadge({ ...base, ...l }, { ...ctx, ...c })

test('id_gate is Confirm ID amber', () => {
  assert.deepEqual(badge({ status: 'id_gate' }), { label: 'Confirm ID', tone: 'amber' })
})
test('gender_gate asks for gender, then measurements', () => {
  assert.deepEqual(badge({ status: 'gender_gate' }, { needsGender: true }), { label: 'Pick gender', tone: 'amber' })
  assert.deepEqual(
    badge({ status: 'gender_gate', gender: 'mens' }, { needsGender: true, needsMeasurements: true }),
    { label: 'Add measurements', tone: 'amber' },
  )
})
test('blocked kinds map to their own labels and win over status', () => {
  const rows = [
    ['photo_quality', 'Retake photos'],
    ['intake_failed', 'Intake failed'],
    ['rewrite_failed', 'Rewrite failed'],
  ] as const
  for (const [kind, label] of rows) {
    assert.deepEqual(badge({ agent_blocked: true, agent_blocked_kind: kind, status: 'finalizing' }), { label, tone: 'amber' })
  }
  assert.deepEqual(badge({ agent_blocked: true }), { label: 'Needs you', tone: 'amber' })
})
test('in_loop states', () => {
  assert.deepEqual(badge({ pipeline_step: 2 }), { label: 'Processing', tone: 'gray' })
  assert.deepEqual(badge({}, { hasStudioPhotos: false }), { label: 'Needs photos', tone: 'amber' })
  assert.deepEqual(badge({ copy_approved_at: '2026-10-13T00:00:00Z' }), { label: 'Finalize', tone: 'amber' })
  assert.deepEqual(badge({}), { label: 'Processing', tone: 'gray' })
})
test('finalizing, published, sold, archived', () => {
  assert.deepEqual(badge({ status: 'finalizing' }), { label: 'Ready to publish', tone: 'blue' })
  assert.deepEqual(badge({ status: 'published', listing_urls: { ebay: 'x' } }), { label: 'Published 1/2', tone: 'emerald' })
  const both = Object.fromEntries(PUBLISH_PLATFORMS.map((p) => [p, 'x']))
  assert.deepEqual(badge({ status: 'published', listing_urls: both }), { label: 'Published', tone: 'purple' })
  assert.deepEqual(badge({ status: 'sold' }), { label: 'Sold', tone: 'green' })
  assert.deepEqual(badge({ status: 'archived' }), { label: 'Archived', tone: 'gray' })
})
test('amber tone class', () => {
  assert.equal(BADGE_TONE_CLASSES.amber, 'bg-amber-900/60 text-amber-300')
})
test('getBadgeContext normalizes category case', () => {
  const c = getBadgeContext({ category: 'Clothing', sub_type: null, intake_meta: null }, true)
  assert.equal(c.needsGender, true)
  assert.deepEqual(
    getBadgeContext({ category: 'CLOTHING', sub_type: 'shirt', intake_meta: null }, true).needsMeasurements,
    getBadgeContext({ category: 'clothing', sub_type: 'shirt', intake_meta: null }, true).needsMeasurements,
  )
})
