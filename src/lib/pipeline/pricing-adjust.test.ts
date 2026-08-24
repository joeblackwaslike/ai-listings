import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionDelta, adjustForCondition, priceTierOf, CATEGORY_DISCOUNT, type PricingListing } from './pricing-adjust'

test('conditionDelta: listing better than comp condition', () => {
  assert.equal(conditionDelta('like_new', 'Good'), 'better')
})

test('conditionDelta: listing worse than comp condition', () => {
  assert.equal(conditionDelta('fair', 'Like new'), 'worse')
})

test('conditionDelta: same rank returns same', () => {
  assert.equal(conditionDelta('good', 'Not specified'), 'same')
})

test('conditionDelta: unknown listing condition defaults to good (rank 4)', () => {
  assert.equal(conditionDelta('', 'Not specified'), 'same')
})

test('adjustForCondition: better applies +15%', () => {
  assert.equal(adjustForCondition(10000, 'better'), 11500)
})

test('adjustForCondition: worse applies -15%', () => {
  assert.equal(adjustForCondition(10000, 'worse'), 8500)
})

test('adjustForCondition: same is unchanged', () => {
  assert.equal(adjustForCondition(10000, 'same'), 10000)
})

test('CATEGORY_DISCOUNT: has an entry for every known category', () => {
  assert.equal(CATEGORY_DISCOUNT.handbag, 0.15)
  assert.equal(CATEGORY_DISCOUNT.electronics, 0.20)
})

test('priceTierOf: boundaries', () => {
  // Design spec: LOW is < $150, MID is $150-$750 inclusive, HIGH is > $750.
  assert.equal(priceTierOf(0), 'low')
  assert.equal(priceTierOf(14_999), 'low')
  assert.equal(priceTierOf(15_000), 'mid')
  assert.equal(priceTierOf(74_999), 'mid')
  assert.equal(priceTierOf(75_000), 'mid')
  assert.equal(priceTierOf(75_001), 'high')
  assert.equal(priceTierOf(1_000_000), 'high')
})

import { inclusionPremiumCents } from './pricing-adjust'
import type { Inclusion } from '@/types/listings'

function inclusion(item: string, overrides: Partial<Inclusion> = {}): Inclusion {
  return { item, source: 'detected', confirmed: true, notes: null, ...overrides }
}

test('inclusionPremiumCents: sums confirmed matched items at the mid tier for handbag', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box'), inclusion('Dust bag/cover')],
    30_000 // mid tier
  )
  assert.equal(cents, 2000 + 1500) // handbag mid: box 2000, dust bag 1500
})

test('inclusionPremiumCents: unconfirmed items contribute nothing', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box', { confirmed: false })],
    30_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: unmatched free-text manual item contributes $0', () => {
  const cents = inclusionPremiumCents(
    'jewelry',
    null,
    [inclusion('Custom velvet pouch', { source: 'manual' })],
    10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: severed brand tag is halved vs. attached', () => {
  const attached = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'attached' })], 10_000 // low tier
  )
  const severed = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'severed' })], 10_000
  )
  assert.equal(attached, 500) // sneakers low: brand tag 500
  assert.equal(severed, 250)
})

test('inclusionPremiumCents: brand tag with no tagState (e.g. added manually, no UI control sets it) gets the halved premium, not full', () => {
  const cents = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag')], 10_000
  )
  assert.equal(cents, 250) // full premium requires an explicit 'attached', not just "not severed"
})

test('inclusionPremiumCents: the authenticity card itself contributes $0 here (handled separately)', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Authenticity card', { docSource: 'original' })], 10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: categories without a custom table fall back to the base item table', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Original box')], 10_000 // low tier
  )
  assert.equal(cents, 400) // BASE_ITEM_PREMIUMS low
})

test('inclusionPremiumCents: matching is case-insensitive', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('original BOX')], 10_000
  )
  assert.equal(cents, 400)
})

import { authenticityPremiumCents } from './pricing-adjust'

test('authenticityPremiumCents: original docSource below threshold applies premium', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original' })],
    10_000 // low tier, below jewelry's $500 threshold
  )
  assert.equal(cents, 500) // original, low tier
})

test('authenticityPremiumCents: at or above the category threshold, premium is $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original' })],
    50_000 // exactly at jewelry's $500 threshold
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: category with no documented threshold always applies', () => {
  const cents = authenticityPremiumCents(
    'watches', null,
    [inclusion('Authenticity card', { docSource: 'reseller' })],
    200_000 // very high price — watches has no threshold entry
  )
  assert.equal(cents, 2500) // reseller, high tier
})

test('authenticityPremiumCents: no confirmed authenticity card returns $0', () => {
  const cents = authenticityPremiumCents('jewelry', null, [], 10_000)
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: confirmed card with no docSource returns $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null, [inclusion('Authenticity card')], 10_000
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: unconfirmed authenticity card returns $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original', confirmed: false })],
    10_000
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: third_party docSource scales by tier', () => {
  const low = authenticityPremiumCents('sneakers', null, [inclusion('Authenticity card', { docSource: 'third_party' })], 5_000)
  const mid = authenticityPremiumCents('watches', null, [inclusion('Authenticity card', { docSource: 'third_party' })], 30_000)
  assert.equal(low, 200)
  assert.equal(mid, 600)
})

import { computeAdjustedPricing } from './pricing-adjust'
import type { PricingComp } from '@/types/listings'

function comp(overrides: Partial<PricingComp> = {}): PricingComp {
  return {
    id: 'comp-1', listing_id: 'listing-1', source: 'ebay', title: 'Test comp',
    sale_price_cents: 10_000, condition: 'Not specified', sold_at: '2026-01-01T00:00:00Z',
    listing_url: 'https://example.com', condition_delta: 'same', adjusted_price_cents: 10_000,
    color: null, relevance_score: null, provider: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

test('computeAdjustedPricing: median of 3 sold comps, includePremiums false matches comps-only estimate', () => {
  const listing: PricingListing =
    { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const comps = [
    comp({ sale_price_cents: 10_000 }),
    comp({ sale_price_cents: 12_000 }),
    comp({ sale_price_cents: 14_000 }),
  ]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: false })
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.priceCents, 12_000)
  assert.equal(result.priceToMoveCents, 10_200) // jewelry: 12000 * (1 - 0.15)
  assert.equal(result.inclusionPremiumCents, 0)
  assert.equal(result.authenticityPremiumCents, 0)
})

test('computeAdjustedPricing: includePremiums true layers inclusion + authenticity premiums onto the base', () => {
  const listing: PricingListing = {
    condition: 'good', category: 'jewelry' as const, sub_type: null,
    inclusions: [
      inclusion('Original box'),
      inclusion('Authenticity card', { docSource: 'original' }),
    ],
  }
  const comps = [comp({ sale_price_cents: 12_000 })]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: true })
  // base 12000 (low tier), + box premium 400 (base table) + auth premium 500 (original, low, below $500 threshold)
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.inclusionPremiumCents, 400)
  assert.equal(result.authenticityPremiumCents, 500)
  assert.equal(result.priceCents, 12_900)
  assert.equal(result.priceToMoveCents, 10_965) // 12900 * 0.85, rounded
})

test('computeAdjustedPricing: active-market comps are excluded from the sold-price median', () => {
  const listing: PricingListing =
    { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const comps = [
    comp({ sale_price_cents: 12_000, source: 'ebay' }),
    comp({ sale_price_cents: 1, source: 'ebay_active' }), // would wreck the median if included
  ]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: false })
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.compCount, 1)
})

test('computeAdjustedPricing: retail (brand-new MSRP) comps are excluded from the sold-price median', () => {
  const listing: PricingListing =
    { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const comps = [
    comp({ sale_price_cents: 12_000, source: 'ebay' }),
    comp({ sale_price_cents: 99_999, source: 'retail' }), // would wreck the median if included
  ]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: false })
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.compCount, 1)
})

test('computeAdjustedPricing: recomputes against the listing\'s CURRENT condition, not any cached comp delta (staleness fix)', () => {
  const comps = [comp({ sale_price_cents: 10_000, condition: 'Like new', condition_delta: 'better', adjusted_price_cents: 99_999 })]

  const worse = computeAdjustedPricing(
    { condition: 'very_good', category: 'jewelry' as const, sub_type: null, inclusions: [] },
    comps, { includePremiums: false }
  )
  const better = computeAdjustedPricing(
    { condition: 'new_with_tags', category: 'jewelry' as const, sub_type: null, inclusions: [] },
    comps, { includePremiums: false }
  )

  // Same comp row (including its stale adjusted_price_cents: 99999), different current
  // condition on the listing — the stored adjusted_price_cents/condition_delta columns are
  // ignored entirely; only listing.condition and the comp's raw condition text are used.
  assert.equal(worse.priceCents, 8_500) // very_good (rank 5) < Like new (rank 6) → worse → 10000 * 0.85
  assert.equal(better.priceCents, 11_500) // new_with_tags (rank 8) > Like new (rank 6) → better → 10000 * 1.15
})

test('computeAdjustedPricing: no sold comps returns null price', () => {
  const listing: PricingListing =
    { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const result = computeAdjustedPricing(listing, [], { includePremiums: false })
  assert.equal(result.basePriceCents, null)
  assert.equal(result.priceCents, null)
  assert.equal(result.priceToMoveCents, null)
})

test('computeAdjustedPricing: no sold comps returns null price even with includePremiums true (no comp-derived base to layer onto, and step4a\'s suggested_price_cents may already reflect the inclusions)', () => {
  const listing: PricingListing = {
    condition: 'good', category: 'jewelry' as const, sub_type: null,
    inclusions: [
      inclusion('Original box'),
      inclusion('Authenticity card', { docSource: 'original' }),
    ],
  }
  const result = computeAdjustedPricing(listing, [], { includePremiums: true })
  assert.equal(result.basePriceCents, null)
  assert.equal(result.priceCents, null)
  assert.equal(result.inclusionPremiumCents, 0)
  assert.equal(result.authenticityPremiumCents, 0)
})
