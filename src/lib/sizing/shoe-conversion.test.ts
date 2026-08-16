import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertShoeSize, SHOE_BRAND_OVERRIDES } from './shoe-conversion'

test('convertShoeSize uses the generic table when no brand override exists', () => {
  const result = convertShoeSize({ brand: 'Nike', system: 'eu', value: 39, gender: 'womens' })
  assert.equal(result.source, 'generic')
  assert.ok(typeof result.usSize === 'number')
  // EU 39 women's -> US 8, per whatismysize.com EU-to-US chart (sourced 2026-08-15).
  assert.equal(result.usSize, 8)
})

// Web search on Chanel/Gucci/Louis Vuitton/Louboutin sizing quirks (2026-08-15) turned up
// only qualitative, style-dependent, and often contradictory anecdotes (e.g. Chanel
// espadrilles reportedly run small while Chanel slingbacks reportedly run true to size;
// Louboutin's own FAQ says the line runs true to size; Louis Vuitton opinions conflict by
// style and source). None of it amounts to a clean, sourced EU/US override table for any of
// the four brands, so SHOE_BRAND_OVERRIDES intentionally seeds nothing. This test asserts the
// fallback behavior instead of a fabricated override.
test('convertShoeSize falls through to generic for brands with no sourced override table', () => {
  for (const brand of ['Chanel', 'Gucci', 'Louis Vuitton', 'Louboutin']) {
    const result = convertShoeSize({ brand, system: 'eu', value: 39, gender: 'womens' })
    assert.equal(result.source, 'generic')
  }
})

test('convertShoeSize is gender-aware', () => {
  const mens = convertShoeSize({ brand: 'Nike', system: 'eu', value: 42, gender: 'mens' })
  const womens = convertShoeSize({ brand: 'Nike', system: 'eu', value: 42, gender: 'womens' })
  assert.notEqual(mens.usSize, womens.usSize)
  // EU 42 -> US men's 8.5, US women's 10, per whatismysize.com EU-to-US chart.
  assert.equal(mens.usSize, 8.5)
  assert.equal(womens.usSize, 10)
})

test('convertShoeSize passes US sizes through unchanged', () => {
  const result = convertShoeSize({ brand: 'Nike', system: 'us', value: 9, gender: 'mens' })
  assert.equal(result.usSize, 9)
  assert.equal(result.source, 'generic')
})

test('convertShoeSize converts UK sizes via the EU+33 offset before lookup', () => {
  // UK 8 -> EU ~41 -> US men's 8, per whatismysize.com EU-to-US chart.
  const result = convertShoeSize({ brand: 'Nike', system: 'uk', value: 8, gender: 'mens' })
  assert.equal(result.usSize, 8)
})

test('convertShoeSize applies a per-gender brand override table when present', () => {
  const fakeBrand = 'test-brand-with-override'
  SHOE_BRAND_OVERRIDES[fakeBrand] = {
    conversions: { mens: [], womens: [{ eu: 39, us: 99 }] },
    note: 'test fixture',
  }
  try {
    const womens = convertShoeSize({ brand: fakeBrand, system: 'eu', value: 39, gender: 'womens' })
    assert.equal(womens.source, 'brand')
    assert.equal(womens.usSize, 99)
    assert.equal(womens.note, 'test fixture')
  } finally {
    delete SHOE_BRAND_OVERRIDES[fakeBrand]
  }
})

test('convertShoeSize falls through to the generic table when the brand override has no entries for the requested gender', () => {
  const fakeBrand = 'test-brand-with-partial-override'
  SHOE_BRAND_OVERRIDES[fakeBrand] = {
    conversions: { mens: [], womens: [{ eu: 39, us: 99 }] },
  }
  try {
    // mens table is empty for this fake brand -- must not throw, must fall through to generic.
    const mens = convertShoeSize({ brand: fakeBrand, system: 'eu', value: 39, gender: 'mens' })
    assert.equal(mens.source, 'generic')
    assert.equal(mens.usSize, 6.5)
  } finally {
    delete SHOE_BRAND_OVERRIDES[fakeBrand]
  }
})

test('convertShoeSize returns the EU and UK legs alongside the US size (EU input)', () => {
  const result = convertShoeSize({ brand: 'Nike', system: 'eu', value: 39, gender: 'womens' })
  assert.equal(result.euSize, 39)
  // UK is derived via the same EU-33 approximation used elsewhere in this file.
  assert.equal(result.ukSize, 6)
})

test('convertShoeSize returns the EU and UK legs alongside the US size (UK input)', () => {
  // UK 8 -> EU 41 (UK+33 offset) -> round-trips back to UK 8 exactly.
  const result = convertShoeSize({ brand: 'Nike', system: 'uk', value: 8, gender: 'mens' })
  assert.equal(result.euSize, 41)
  assert.equal(result.ukSize, 8)
})

test('convertShoeSize derives the EU/UK legs via reverse lookup for a US-system input', () => {
  // US men's 9 is an exact table entry at EU 42.5 (see SHOE_SIZE_CONVERSION.mens).
  const result = convertShoeSize({ brand: 'Nike', system: 'us', value: 9, gender: 'mens' })
  assert.equal(result.usSize, 9)
  assert.equal(result.euSize, 42.5)
  assert.equal(result.ukSize, 9.5)
})

test('convertShoeSize keeps the EU leg as the passthrough value even when a brand override changes the US leg', () => {
  const fakeBrand = 'test-brand-with-override'
  SHOE_BRAND_OVERRIDES[fakeBrand] = {
    conversions: { mens: [], womens: [{ eu: 39, us: 99 }] },
    note: 'test fixture',
  }
  try {
    const result = convertShoeSize({ brand: fakeBrand, system: 'eu', value: 39, gender: 'womens' })
    assert.equal(result.usSize, 99)
    assert.equal(result.euSize, 39)
    assert.equal(result.ukSize, 6)
  } finally {
    delete SHOE_BRAND_OVERRIDES[fakeBrand]
  }
})
