import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDisplayPriceCents } from './ListingCard'

test('resolveDisplayPriceCents: prefers final_price_cents over suggested_price_cents when a human override is set', () => {
  assert.equal(
    resolveDisplayPriceCents({ final_price_cents: 12000, suggested_price_cents: 9000 }),
    12000
  )
})

test('resolveDisplayPriceCents: falls back to suggested_price_cents when no override is set', () => {
  assert.equal(
    resolveDisplayPriceCents({ final_price_cents: null, suggested_price_cents: 9000 }),
    9000
  )
})

test('resolveDisplayPriceCents: returns null when neither price is set', () => {
  assert.equal(
    resolveDisplayPriceCents({ final_price_cents: null, suggested_price_cents: null }),
    null
  )
})
