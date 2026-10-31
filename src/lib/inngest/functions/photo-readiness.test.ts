import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideReadiness } from './photo-readiness'

const processed = { type: 'studio' as const, processed_url: 'https://x/p.png' }
const unprocessed = { type: 'studio' as const, processed_url: null }
const settled = { status: 'in_loop' as const, pipeline_step: 5, pipeline_total: 5 }
const unconfirmed = { ...settled, photos_confirmed: false }
const confirmed = { ...settled, photos_confirmed: true }

test('waits while any studio photo is still unprocessed', () => {
  assert.deepEqual(
    decideReadiness(unconfirmed, [processed, unprocessed]),
    { confirmNow: false, batchReady: false }
  )
  assert.deepEqual(
    decideReadiness(confirmed, [processed, unprocessed]),
    { confirmNow: false, batchReady: false }
  )
})

test('confirms and marks the batch ready when everything is processed and not yet confirmed', () => {
  assert.deepEqual(
    decideReadiness(unconfirmed, [processed, processed]),
    { confirmNow: true, batchReady: true }
  )
})

test('only marks the batch ready for a later upload on an already-confirmed listing', () => {
  assert.deepEqual(
    decideReadiness(confirmed, [processed, processed]),
    { confirmNow: false, batchReady: true }
  )
})

test('ignores non-studio photos', () => {
  assert.deepEqual(
    decideReadiness(unconfirmed, [processed, { type: 'intake', processed_url: null }]),
    { confirmNow: true, batchReady: true }
  )
})

test('does nothing when there are no studio photos', () => {
  assert.deepEqual(
    decideReadiness(unconfirmed, [{ type: 'intake', processed_url: 'https://x/i.png' }]),
    { confirmNow: false, batchReady: false }
  )
})

test('does nothing while the pipeline still has steps to run', () => {
  assert.deepEqual(
    decideReadiness({ ...unconfirmed, pipeline_step: 3 }, [processed]),
    { confirmNow: false, batchReady: false }
  )
})

test('does nothing while the listing waits at intake or a pre-photo gate', () => {
  for (const status of ['intake', 'id_gate', 'gender_gate'] as const) {
    assert.deepEqual(
      decideReadiness({ ...unconfirmed, status }, [processed]),
      { confirmNow: false, batchReady: false },
      status
    )
  }
})
