import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishListingToEbay } from './publish-to-ebay'
import type { EbayPublisher, EbayPublishResult } from './publish-to-ebay'
import type { Listing, PricingComp } from '@/types/listings'

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
    retail_price_url: null,
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
    condition_confirmed: true,
    is_luxury: false,
    intake_meta: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function fixtureComp(overrides: Partial<PricingComp> = {}): PricingComp {
  return {
    id: 'comp-1', listing_id: 'listing-1', source: 'ebay', title: 'Comp',
    sale_price_cents: 12_000, condition: 'Not specified', sold_at: '2026-01-01T00:00:00Z',
    listing_url: 'https://example.com', condition_delta: 'same', adjusted_price_cents: 12_000,
    color: null, relevance_score: null, provider: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function fakeAdapter(result: EbayPublishResult): EbayPublisher {
  return {
    createListing: async () => result,
  }
}

function stubSupabase() {
  const updateCalls: Array<{ table: string; values: unknown; eqId: string }> = []
  const insertCalls: Array<{ table: string; row: unknown }> = []
  let updateError: { message: string } | null = null
  let insertError: { message: string } | null = null
  let insertRejection: Error | null = null

  const supabase = {
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (_col: string, eqId: string) => {
          updateCalls.push({ table, values, eqId })
          return Promise.resolve({ error: updateError })
        },
      }),
      insert: (row: unknown) => {
        insertCalls.push({ table, row })
        if (insertRejection) return Promise.reject(insertRejection)
        return Promise.resolve({ error: insertError })
      },
    }),
  }

  return {
    supabase: supabase as unknown as SupabaseClient,
    updateCalls,
    insertCalls,
    setUpdateError: (err: { message: string } | null) => { updateError = err },
    setInsertError: (err: { message: string } | null) => { insertError = err },
    setInsertRejection: (err: Error | null) => { insertRejection = err },
  }
}

test('publishListingToEbay records a platform_price_events row with the actual price sent to eBay', async () => {
  const { supabase, insertCalls } = stubSupabase()
  const adapter = fakeAdapter({ platformId: 'ebay-item-1', offerId: 'offer-1', url: 'https://ebay.com/itm/1' })

  await publishListingToEbay(supabase, fixtureListing({ final_price_cents: 15_000 }), [], [fixtureComp()], adapter)

  const priceEventInsert = insertCalls.find((c) => c.table === 'platform_price_events')
  assert.ok(priceEventInsert, 'expected an insert into platform_price_events')
  assert.deepEqual(priceEventInsert!.row, {
    listing_id: 'listing-1',
    platform: 'ebay',
    event_type: 'published',
    price_cents: 15_000,
  })
})

test('publishListingToEbay records the fallback-derived price (no final_price_cents override) as the platform price event', async () => {
  const { supabase, insertCalls } = stubSupabase()
  const adapter = fakeAdapter({ platformId: 'ebay-item-2', offerId: 'offer-2', url: 'https://ebay.com/itm/2' })

  await publishListingToEbay(
    supabase,
    fixtureListing({ suggested_price_cents: 9_999 }),
    [],
    [],
    adapter,
  )

  const priceEventInsert = insertCalls.find((c) => c.table === 'platform_price_events')
  assert.ok(priceEventInsert)
  assert.equal((priceEventInsert!.row as { price_cents: number }).price_cents, 9_999)
})

test('publishListingToEbay updates the listings row with platform IDs, URL, and published status', async () => {
  const { supabase, updateCalls } = stubSupabase()
  const adapter = fakeAdapter({ platformId: 'ebay-item-3', offerId: 'offer-3', url: 'https://ebay.com/itm/3' })

  await publishListingToEbay(supabase, fixtureListing(), [], [fixtureComp()], adapter)

  const listingsUpdate = updateCalls.find((c) => c.table === 'listings')
  assert.ok(listingsUpdate)
  assert.equal(listingsUpdate!.eqId, 'listing-1')
  const values = listingsUpdate!.values as { status: string; listing_urls: Record<string, string> }
  assert.equal(values.status, 'published')
  assert.equal(values.listing_urls.ebay, 'https://ebay.com/itm/3')
})

test('publishListingToEbay does not record a price event or throw when the underlying listings update fails', async () => {
  const { supabase, insertCalls, setUpdateError } = stubSupabase()
  setUpdateError({ message: 'db unavailable' })
  const adapter = fakeAdapter({ platformId: 'ebay-item-4', offerId: 'offer-4', url: 'https://ebay.com/itm/4' })

  await assert.rejects(
    () => publishListingToEbay(supabase, fixtureListing(), [], [fixtureComp()], adapter),
    /db unavailable/,
  )

  assert.equal(insertCalls.find((c) => c.table === 'platform_price_events'), undefined)
})

test('publishListingToEbay still returns the publish result when recording the price event fails', async () => {
  const { supabase, setInsertError } = stubSupabase()
  setInsertError({ message: 'insert failed' })
  const adapter = fakeAdapter({ platformId: 'ebay-item-5', offerId: 'offer-5', url: 'https://ebay.com/itm/5' })

  const result = await publishListingToEbay(supabase, fixtureListing(), [], [fixtureComp()], adapter)

  assert.equal(result.platformId, 'ebay-item-5')
})

test('publishListingToEbay still returns the publish result when the price event insert call itself rejects', async () => {
  const { supabase, setInsertRejection } = stubSupabase()
  setInsertRejection(new Error('transport failure'))
  const adapter = fakeAdapter({ platformId: 'ebay-item-6', offerId: 'offer-6', url: 'https://ebay.com/itm/6' })

  const result = await publishListingToEbay(supabase, fixtureListing(), [], [fixtureComp()], adapter)

  assert.equal(result.platformId, 'ebay-item-6')
})
