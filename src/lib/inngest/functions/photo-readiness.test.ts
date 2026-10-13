import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideReadiness } from './photo-readiness'

const processed = { type: 'studio' as const, processed_url: 'https://x/p.png' }
const unprocessed = { type: 'studio' as const, processed_url: null }

test('waits while any studio photo is still unprocessed', () => {
  assert.deepEqual(
    decideReadiness({ photos_confirmed: false }, [processed, unprocessed]),
    { confirmNow: false, batchReady: false }
  )
  assert.deepEqual(
    decideReadiness({ photos_confirmed: true }, [processed, unprocessed]),
    { confirmNow: false, batchReady: false }
  )
})

test('confirms and marks the batch ready when everything is processed and not yet confirmed', () => {
  assert.deepEqual(
    decideReadiness({ photos_confirmed: false }, [processed, processed]),
    { confirmNow: true, batchReady: true }
  )
})

test('only marks the batch ready for a later upload on an already-confirmed listing', () => {
  assert.deepEqual(
    decideReadiness({ photos_confirmed: true }, [processed, processed]),
    { confirmNow: false, batchReady: true }
  )
})

test('ignores non-studio photos', () => {
  assert.deepEqual(
    decideReadiness({ photos_confirmed: false }, [processed, { type: 'intake', processed_url: null }]),
    { confirmNow: true, batchReady: true }
  )
})

test('does nothing when there are no studio photos', () => {
  assert.deepEqual(
    decideReadiness({ photos_confirmed: false }, [{ type: 'intake', processed_url: 'https://x/i.png' }]),
    { confirmNow: false, batchReady: false }
  )
})
