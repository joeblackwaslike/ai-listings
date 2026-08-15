import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectJewelrySubType } from './jewelry-detection'

test('detectJewelrySubType identifies a necklace from the Model line', () => {
  const features = ['Model: Elsa Peretti Teardrop Pendant Necklace', 'Chain length: approximately 16"']
  assert.equal(detectJewelrySubType(features), 'necklace')
})

test('detectJewelrySubType identifies a ring from the Model line', () => {
  const features = ['Model: Elsa Peretti Teardrop Bypass Ring', 'Style: Open bypass band with teardrop terminal']
  assert.equal(detectJewelrySubType(features), 'ring')
})

test('detectJewelrySubType identifies a bangle', () => {
  assert.equal(detectJewelrySubType(['Model: Hermès Enamel Bangle']), 'bangle')
})

test('detectJewelrySubType returns null when nothing matches', () => {
  assert.equal(detectJewelrySubType(['Model: Mystery Jewelry Item']), null)
})

test('detectJewelrySubType returns null for an empty list', () => {
  assert.equal(detectJewelrySubType([]), null)
})

test('detectJewelrySubType identifies a bracelet', () => {
  assert.equal(detectJewelrySubType(['Model: Tennis Bracelet']), 'bracelet')
})

test('detectJewelrySubType identifies earrings', () => {
  assert.equal(detectJewelrySubType(['Model: Diamond Stud Earrings']), 'earrings')
})

test('detectJewelrySubType identifies a pendant', () => {
  assert.equal(detectJewelrySubType(['Model: Gold Heart Pendant']), 'pendant')
})

test('detectJewelrySubType identifies a brooch', () => {
  assert.equal(detectJewelrySubType(['Model: Vintage Enamel Brooch']), 'brooch')
})

test('detectJewelrySubType resolves "Ring-Style" as ring, not earrings, due to check ordering', () => {
  // "ring" is checked before "earrings" in detectJewelrySubType. The hyphen in
  // "Ring-Style" is a non-word character, so /\bring\b/ treats "ring" as a
  // standalone word (bounded by the string start and the hyphen) and matches
  // before the earrings check ever runs — even though "Huggie Earrings" is
  // also present and arguably the better classification. This asserts the
  // real, current behavior (a known false-positive edge case), not the
  // ideal one.
  assert.equal(detectJewelrySubType(['Model: Ring-Style Huggie Earrings']), 'ring')
})
