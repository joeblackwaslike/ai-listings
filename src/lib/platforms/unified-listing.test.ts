import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUnifiedListingForEbay } from './unified-listing'
import type { Listing, Photo } from '@/types/listings'

function fixtureListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    sku: 'HB-0001',
    status: 'finalizing',
    pipeline_step: 4,
    pipeline_total: 5,
    title: 'Coach Handbag',
    description: 'Generic description',
    category: 'handbag',
    brand: 'Coach',
    condition: 'like_new',
    condition_notes: null,
    gender: null,
    item_size: null,
    sub_type: null,
    measurements: null,
    tags: [],
    inclusions: [],
    suggested_price_cents: 12000,
    final_price_cents: null,
    confidence_score: null,
    price_to_move_cents: null,
    price_to_move_discount_pct: null,
    retail_price_cents: null,
    retail_price_source: null,
    retail_promo_note: null,
    lowest_active_price_cents: null,
    lowest_active_url: null,
    lowest_active_source: null,
    pricing_methodology: null,
    auth_plan: [],
    photo_plan: [],
    platform_fields: {
      ebay: {
        title: 'Coach Handbag — Like New',
        category_id: '169291',
        item_specifics: { Brand: 'Coach', Material: 'Leather' },
        condition_id: '1500',
        description: 'eBay-optimized description',
      },
    },
    listing_urls: {},
    agent_blocked: false,
    agent_blocked_reason: null,
    auto_discount_enabled: null,
    auto_discount_pct: null,
    auto_discount_interval_days: null,
    photos_confirmed: true,
    skip_background_removal: false,
    is_luxury: false,
    intake_meta: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function fixturePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'photo-1',
    listing_id: 'listing-1',
    type: 'studio',
    raw_url: 'https://supabase.example/storage/raw-1.jpg',
    processed_url: 'https://supabase.example/storage/processed-1.jpg',
    display_order: 0,
    photoroom_meta: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

test('buildUnifiedListingForEbay maps title/description/item_specifics from platform_fields.ebay', async () => {
  const result = await buildUnifiedListingForEbay(fixtureListing(), [])
  assert.equal(result.title, 'Coach Handbag — Like New')
  assert.equal(result.description, 'eBay-optimized description')
  assert.deepEqual(result.platformFields, {
    item_specifics: { Brand: 'Coach', Material: 'Leather' },
    category_id: '169291',
  })
})

test('buildUnifiedListingForEbay uses the top-level internal condition enum, not platform_fields.ebay.condition_id', async () => {
  const result = await buildUnifiedListingForEbay(fixtureListing(), [])
  // listing.condition is 'like_new' (internal ConditionValue enum) — platform_fields.ebay.condition_id
  // ('1500') is eBay's own numeric condition ID and must NOT leak into UnifiedListing.condition,
  // since EbayAdapter re-derives the numeric ID from the internal enum via mapConditionToEbay/
  // mapConditionIdToEbay.
  assert.equal(result.condition, 'like_new')
})

test('buildUnifiedListingForEbay uses internalId from sku', async () => {
  const result = await buildUnifiedListingForEbay(fixtureListing(), [])
  assert.equal(result.internalId, 'HB-0001')
})

test('buildUnifiedListingForEbay falls back to suggested_price_cents when final_price_cents is unset', async () => {
  const result = await buildUnifiedListingForEbay(fixtureListing(), [])
  assert.equal(result.price, 12000)
})

test('buildUnifiedListingForEbay prefers final_price_cents over suggested_price_cents when both are set', async () => {
  const result = await buildUnifiedListingForEbay(
    fixtureListing({ final_price_cents: 15000, suggested_price_cents: 12000 }),
    [],
  )
  assert.equal(result.price, 15000)
})

test('buildUnifiedListingForEbay filters to studio photos only, sorted by display_order, preferring processed_url', async () => {
  const photos: Photo[] = [
    fixturePhoto({ id: 'p2', type: 'studio', display_order: 2, processed_url: 'https://x/p2-processed.jpg' }),
    fixturePhoto({ id: 'p0', type: 'studio', display_order: 0, processed_url: 'https://x/p0-processed.jpg' }),
    fixturePhoto({ id: 'p-intake', type: 'intake', display_order: -1, processed_url: null }),
    fixturePhoto({ id: 'p1', type: 'studio', display_order: 1, processed_url: null, raw_url: 'https://x/p1-raw.jpg' }),
  ]
  const result = await buildUnifiedListingForEbay(fixtureListing(), photos)
  assert.deepEqual(result.imageUrls, [
    'https://x/p0-processed.jpg',
    'https://x/p1-raw.jpg',
    'https://x/p2-processed.jpg',
  ])
})

test('buildUnifiedListingForEbay throws when platform_fields.ebay is missing', async () => {
  await assert.rejects(
    () => buildUnifiedListingForEbay(fixtureListing({ platform_fields: {} }), []),
    /platform_fields\.ebay/,
  )
})

test('buildUnifiedListingForEbay throws when sku is not yet assigned', async () => {
  await assert.rejects(
    () => buildUnifiedListingForEbay(fixtureListing({ sku: null }), []),
    /sku/,
  )
})
