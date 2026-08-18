import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasIncludedBox, needsBoxMeasurement, needsWeight, HEAVY_ITEM_CATEGORIES } from './finalizing-checklist'
import type { Inclusion } from '@/types/listings'

test('hasIncludedBox: matches an included inclusion mentioning "box" case-insensitively', () => {
  assert.equal(hasIncludedBox([{ item: 'Original Box', source: 'manual', confirmed: true, notes: null } as Inclusion]), true)
  assert.equal(hasIncludedBox([{ item: 'dust bag', source: 'manual', confirmed: true, notes: null } as Inclusion]), false)
  assert.equal(hasIncludedBox([{ item: 'Original Box', source: 'manual', confirmed: false, notes: null } as Inclusion]), false)
  assert.equal(hasIncludedBox([]), false)
})

test('needsBoxMeasurement: true when box is included and no box measurement stored yet', () => {
  const listing = { inclusions: [{ item: 'Original Box', source: 'manual', confirmed: true, notes: null } as Inclusion], measurements: null }
  assert.equal(needsBoxMeasurement(listing), true)
})

test('needsBoxMeasurement: false when no box is included', () => {
  const listing = { inclusions: [], measurements: null }
  assert.equal(needsBoxMeasurement(listing), false)
})

test('needsBoxMeasurement: false once all three box dimensions are stored', () => {
  const listing = {
    inclusions: [{ item: 'Original Box', source: 'manual', confirmed: true, notes: null } as Inclusion],
    measurements: { box_length_in: 10, box_width_in: 8, box_height_in: 4 },
  }
  assert.equal(needsBoxMeasurement(listing), false)
})

test('needsWeight: true for heavy-item categories with no weight stored', () => {
  assert.equal(needsWeight({ category: 'handbag', measurements: null }), true)
  for (const category of HEAVY_ITEM_CATEGORIES) {
    assert.equal(needsWeight({ category, measurements: null }), true)
  }
})

test('needsWeight: false for jewelry and sneakers regardless of weight', () => {
  assert.equal(needsWeight({ category: 'jewelry', measurements: null }), false)
  assert.equal(needsWeight({ category: 'sneakers', measurements: null }), false)
})

test('needsWeight: false once weight_oz is stored', () => {
  assert.equal(needsWeight({ category: 'handbag', measurements: { weight_oz: 12 } }), false)
})
