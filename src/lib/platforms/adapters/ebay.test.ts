import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapItemSpecificsToAspects } from './ebay'

test('mapItemSpecificsToAspects wraps each flat value in a single-element array', () => {
  const result = mapItemSpecificsToAspects({ Brand: 'Coach', Material: 'Leather' })
  assert.deepEqual(result, { Brand: ['Coach'], Material: ['Leather'] })
})

test('mapItemSpecificsToAspects drops empty-string values', () => {
  const result = mapItemSpecificsToAspects({ Brand: 'Coach', Color: '' })
  assert.deepEqual(result, { Brand: ['Coach'] })
})

test('mapItemSpecificsToAspects returns {} for undefined input', () => {
  assert.deepEqual(mapItemSpecificsToAspects(undefined), {})
})

test('mapItemSpecificsToAspects returns {} for an empty object', () => {
  assert.deepEqual(mapItemSpecificsToAspects({}), {})
})
