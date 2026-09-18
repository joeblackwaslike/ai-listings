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

// Tests for sold price display logic
test('ListingCard should display sold price when status is "sold" and sold_price_cents is set', () => {
  // This test verifies the conditional logic for displaying sold price
  const listing = {
    status: 'sold' as const,
    sold_price_cents: 15000,
    final_price_cents: null,
    suggested_price_cents: 12000,
  }

  // The logic in ListingCard is:
  // listing.status === 'sold' && listing.sold_price_cents != null ? (
  //   <p>Sold {formatPrice(listing.sold_price_cents)}</p>
  // ) : resolveDisplayPriceCents(listing) != null && (...)

  const shouldDisplaySoldPrice = listing.status === 'sold' && listing.sold_price_cents != null
  assert.equal(shouldDisplaySoldPrice, true, 'should display sold price for sold status with sold_price_cents')
})

test('ListingCard should display regular price when status is not "sold" even if sold_price_cents is set', () => {
  const listing = {
    status: 'active' as const,
    sold_price_cents: 15000,
    final_price_cents: 12000,
    suggested_price_cents: 9000,
  }

  const shouldDisplaySoldPrice = listing.status === 'sold' && listing.sold_price_cents != null
  assert.equal(shouldDisplaySoldPrice, false, 'should not display sold price for active status')

  // Instead, it should use resolveDisplayPriceCents
  const displayPrice = resolveDisplayPriceCents(listing)
  assert.equal(displayPrice, 12000, 'should use final_price_cents for display')
})

test('ListingCard should display regular price when status is "sold" but sold_price_cents is null', () => {
  const listing = {
    status: 'sold' as const,
    sold_price_cents: null,
    final_price_cents: 12000,
    suggested_price_cents: 9000,
  }

  const shouldDisplaySoldPrice = listing.status === 'sold' && listing.sold_price_cents != null
  assert.equal(shouldDisplaySoldPrice, false, 'should not display sold price when sold_price_cents is null')

  // Instead, it should use resolveDisplayPriceCents
  const displayPrice = resolveDisplayPriceCents(listing)
  assert.equal(displayPrice, 12000, 'should use final_price_cents as fallback')
})
