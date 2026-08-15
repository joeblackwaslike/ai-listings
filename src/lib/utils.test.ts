import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMeasurementFields } from './utils'

test('getMeasurementFields: jewelry ring on a plain band asks for one ID reading', () => {
  const fields = getMeasurementFields('jewelry', 'ring', ['Model: Classic Gold Band Ring', 'Style: Plain polished band'])
  assert.ok(fields.some((f) => f.key === 'ring_inscribed_size'))
  assert.ok(fields.some((f) => f.key === 'ring_id_mm'))
  assert.equal(fields.some((f) => f.key === 'ring_id_widest_mm'), false)
})

test('getMeasurementFields: jewelry ring on an irregular band asks for widest+narrowest', () => {
  const fields = getMeasurementFields('jewelry', 'ring', ['Model: Teardrop Bypass Ring', 'Style: Open bypass band'])
  assert.ok(fields.some((f) => f.key === 'ring_id_widest_mm'))
  assert.ok(fields.some((f) => f.key === 'ring_id_narrowest_mm'))
  assert.equal(fields.some((f) => f.key === 'ring_id_mm'), false)
})

test('getMeasurementFields: jewelry bangle asks for inner diameter', () => {
  const fields = getMeasurementFields('jewelry', 'bangle', ['Model: Hermès Enamel Bangle'])
  assert.deepEqual(fields.map((f) => f.key), ['bangle_id_mm'])
})

test('getMeasurementFields: jewelry necklace asks for chain length', () => {
  const fields = getMeasurementFields('jewelry', 'necklace', ['Model: Pendant Necklace'])
  assert.deepEqual(fields.map((f) => f.key), ['necklace_chain_length_in'])
})

test('getMeasurementFields: jewelry sub-types without dedicated fields fall back to generic W/H/D', () => {
  const fields = getMeasurementFields('jewelry', 'earrings', [])
  assert.deepEqual(fields.map((f) => f.key), ['width', 'height', 'depth'])
})

test('getMeasurementFields: jewelry with no detected sub-type falls back to generic W/H/D', () => {
  const fields = getMeasurementFields('jewelry', null, [])
  assert.deepEqual(fields.map((f) => f.key), ['width', 'height', 'depth'])
})

test('getMeasurementFields: existing clothing behavior is unchanged (regression check)', () => {
  const fields = getMeasurementFields('clothing', 'jeans', [])
  assert.deepEqual(fields.map((f) => f.key), ['waist', 'inseam'])
})

test('getMeasurementFields: sneakers ask for sizing system, raw size, and optional US size', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  assert.deepEqual(fields.map((f) => f.key), ['shoe_size_system', 'shoe_size_raw', 'us_size'])
})

test('getMeasurementFields: sneakers asks for a sizing system and a size value', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  const systemField = fields.find((f) => f.key === 'shoe_size_system')
  assert.ok(systemField)
  assert.equal(systemField?.useChips, true)
  assert.ok(systemField?.chipOptions?.includes('US'))
  assert.ok(systemField?.chipOptions?.includes('EU'))
  assert.ok(fields.some((f) => f.key === 'shoe_size_raw'))
  assert.ok(fields.some((f) => f.key === 'us_size'))
})

test('getMeasurementFields: jewelry ring called without notableFeatures (2-arg form) defaults to the non-irregular single-reading path', () => {
  const fields = getMeasurementFields('jewelry', 'ring')
  assert.deepEqual(fields.map((f) => f.key), ['ring_inscribed_size', 'ring_id_mm'])
})
