import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectJewelrySubType, detectIrregularRingStyle } from './jewelry-detection'

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

test('detectIrregularRingStyle is true for a bypass band', () => {
  const features = ['Model: Elsa Peretti Teardrop Bypass Ring', 'Style: Open bypass band with teardrop terminal']
  assert.equal(detectIrregularRingStyle(features), true)
})

test('detectIrregularRingStyle is false for a plain band', () => {
  assert.equal(detectIrregularRingStyle(['Model: Classic Gold Band Ring', 'Style: Plain polished band']), false)
})

test('detectIrregularRingStyle is false when there is no style info at all', () => {
  assert.equal(detectIrregularRingStyle(['Model: Ring']), false)
})

test('detectIrregularRingStyle is true for a wrap ring', () => {
  assert.equal(detectIrregularRingStyle(['Style: Wrap ring design']), true)
})

test('detectIrregularRingStyle is true for an open band', () => {
  assert.equal(detectIrregularRingStyle(['Style: Open band ring']), true)
})

test('detectIrregularRingStyle is true for an asymmetric design', () => {
  assert.equal(detectIrregularRingStyle(['Style: Asymmetric statement ring']), true)
})

test('detectIrregularRingStyle is true for an adjustable open band', () => {
  assert.equal(detectIrregularRingStyle(['Style: Adjustable open band']), true)
})

test('detectIrregularRingStyle is true for a toi-et-moi setting', () => {
  assert.equal(detectIrregularRingStyle(['Style: Toi-et-moi setting with two stones']), true)
})

test('detectIrregularRingStyle is false for "unwrapped" (word-boundary regression)', () => {
  assert.equal(detectIrregularRingStyle(['Condition notes: Ships unwrapped, no original box']), false)
})
