import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPipelineSteps } from './pipeline-steps'
import type { Listing, Photo } from '@/types/listings'

const T0 = '2026-10-01T00:00:00Z'
const T1 = '2026-10-02T00:00:00Z'

function listing(over: Partial<Listing> = {}): Listing {
  return {
    status: 'in_loop',
    pipeline_step: 5,
    is_luxury: true,
    auth_plan: [{ step: 'a', guidance: '', status: 'done', photo_required: false }],
    inclusions: [{ item: 'box', source: 'detected', confirmed: true, notes: null }],
    photos_confirmed: false,
    skip_background_removal: false,
    condition_confirmed: false,
    copy_approved_at: null,
    quality_checked_at: null,
    intake_meta: null,
    listing_urls: {},
    ...over,
  } as unknown as Listing
}

function studio(over: Partial<Photo> = {}): Photo {
  return { id: 'p', type: 'studio', processed_url: 'x', created_at: T0, photoroom_meta: null, ...over } as unknown as Photo
}

const states = (l: Listing, p: Photo[] = []) => buildPipelineSteps(l, p).map((s) => `${s.key}:${s.state}`)
const active = (l: Listing, p: Photo[] = []) => buildPipelineSteps(l, p).filter((s) => s.state === 'active').map((s) => s.key)

test('luxury keys follow spec order', () => {
  assert.deepEqual(
    buildPipelineSteps(listing(), []).map((s) => s.key),
    ['product_id', 'vision', 'confirm_id', 'pricing', 'draft', 'auth_plan', 'inclusions_auth', 'photo_shoot', 'bg_removal', 'quality_check', 'condition_review', 'copy_review', 'finalize', 'publish'],
  )
})

test('exactly one active step, the first not done, at several stages', () => {
  assert.deepEqual(active(listing({ status: 'id_gate', pipeline_step: 2 })), ['confirm_id'])
  assert.deepEqual(active(listing({ pipeline_step: 3 })), ['draft'])
  assert.deepEqual(active(listing()), ['photo_shoot'])
  const p = [studio()]
  assert.deepEqual(active(listing(), p), ['quality_check'])
  assert.deepEqual(active(listing({ photos_confirmed: true, quality_checked_at: T1 }), p), ['condition_review'])
  assert.deepEqual(active(listing({ photos_confirmed: true, quality_checked_at: T1, condition_confirmed: true }), p), ['copy_review'])
  assert.deepEqual(
    active(listing({ photos_confirmed: true, quality_checked_at: T1, condition_confirmed: true, copy_approved_at: T1 }), p),
    ['finalize'],
  )
  assert.deepEqual(
    active(listing({ status: 'finalizing', photos_confirmed: true, quality_checked_at: T1, condition_confirmed: true, copy_approved_at: T1 }), p),
    ['publish'],
  )
})

test('non-luxury omits auth_plan and labels step 7 Inclusions', () => {
  const steps = buildPipelineSteps(listing({ is_luxury: false }), [])
  assert.equal(steps.some((s) => s.key === 'auth_plan'), false)
  assert.equal(steps.find((s) => s.key === 'inclusions_auth')?.label, 'Inclusions')
})

test('text intake omits confirm_id', () => {
  const steps = buildPipelineSteps(listing({ intake_meta: { source: 'text' } }), [])
  assert.equal(steps.some((s) => s.key === 'confirm_id'), false)
})

test('skip_background_removal relabels bg_removal', () => {
  const s = buildPipelineSteps(listing({ skip_background_removal: true }), [])
  assert.equal(s.find((x) => x.key === 'bg_removal')?.label, 'Keep Original Backgrounds')
})

test('studio photos with unconfirmed inclusions: inclusions active, photo_shoot done, single active', () => {
  const l = listing({ inclusions: [{ item: 'box', source: 'detected', confirmed: false, notes: null }] })
  const s = states(l, [studio()])
  assert.ok(s.includes('inclusions_auth:active'))
  assert.ok(s.includes('photo_shoot:done'))
  assert.equal(active(l, [studio()]).length, 1)
})

test('published: all done, last label Published', () => {
  const steps = buildPipelineSteps(listing({ status: 'published', pipeline_step: 5 }), [])
  assert.ok(steps.every((s) => s.state === 'done'))
  assert.equal(steps.at(-1)?.label, 'Published')
})

test('quality_check not done when checked before newest studio photo', () => {
  const l = listing({ photos_confirmed: true, quality_checked_at: T0 })
  const q = (p: Photo[]) => buildPipelineSteps(l, p).find((s) => s.key === 'quality_check')?.state
  assert.equal(q([studio({ created_at: T1 })]), 'active')
  assert.equal(q([studio({ created_at: T0 })]), 'done')
  assert.equal(q([studio({ created_at: T0, photoroom_meta: { quality_failed: true } })]), 'active')
})

test('quality_check is not done with no studio photos', () => {
  const l = listing({ photos_confirmed: true, quality_checked_at: T1 })
  assert.notEqual(buildPipelineSteps(l, []).find((s) => s.key === 'quality_check')?.state, 'done')
})
