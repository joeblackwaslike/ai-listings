import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectPoshmarkPhotos, buildUnifiedListingForPoshmark } from '../publish-to-poshmark'
import type { Photo, Listing } from '@/types/listings'

const makePhoto = (overrides: Partial<Photo>): Photo => ({
  id: 'p1',
  listing_id: 'l1',
  type: 'studio',
  raw_url: 'https://example.com/raw.jpg',
  processed_url: 'https://example.com/processed.jpg',
  display_order: 1,
  photoroom_meta: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

const baseListing: Listing = {
  id: 'l1',
  sku: 'WA-001',
  status: 'ready',
  condition: 'like_new',
  brand: 'Rolex',
  suggested_price_cents: 50000,
  final_price_cents: null,
  pipeline_step: 4,
  platform_fields: {
    poshmark: {
      title: 'Rolex Submariner',
      description: 'Classic sports watch.',
      department: 'Men',
      category: 'Accessories',
      subcategory: 'Watches',
      size: 'One Size',
      colors: ['Black', 'Silver'],
      style_tags: ['Luxury', 'Classic', 'Diver'],
    },
  },
  listing_urls: {},
  measurements: null,
  photos_confirmed: false,
  inclusions_confirmed: false,
  condition_confirmed: false,
} as unknown as Listing

describe('selectPoshmarkPhotos', () => {
  it('returns studio photos ordered by display_order', () => {
    const photos = [
      makePhoto({ id: 'p2', display_order: 2 }),
      makePhoto({ id: 'p1', display_order: 1 }),
    ]
    const result = selectPoshmarkPhotos(photos)
    assert.deepEqual(result.map((p) => p.id), ['p1', 'p2'])
  })

  it('appends auth_card photos after studio photos', () => {
    const photos = [
      makePhoto({ id: 'studio1', type: 'studio', display_order: 1 }),
      makePhoto({ id: 'auth1', type: 'auth_card', display_order: 1 }),
      makePhoto({ id: 'studio2', type: 'studio', display_order: 2 }),
    ]
    const result = selectPoshmarkPhotos(photos)
    assert.deepEqual(result.map((p) => p.id), ['studio1', 'studio2', 'auth1'])
  })

  it('caps at 16 photos total', () => {
    const photos = Array.from({ length: 20 }, (_, i) =>
      makePhoto({ id: `p${i}`, display_order: i })
    )
    assert.equal(selectPoshmarkPhotos(photos).length, 16)
  })

  it('auth_card photos are included even if studio photos fill the 16 cap', () => {
    const studio = Array.from({ length: 16 }, (_, i) =>
      makePhoto({ id: `s${i}`, type: 'studio', display_order: i })
    )
    const auth = [makePhoto({ id: 'auth1', type: 'auth_card', display_order: 0 })]
    const result = selectPoshmarkPhotos([...studio, ...auth])
    assert.equal(result.length, 16)
    assert.ok(result.some((p) => p.id === 'auth1'))
  })

  it('uses photoIds override when provided', () => {
    const photos = [
      makePhoto({ id: 'p1', display_order: 1 }),
      makePhoto({ id: 'p2', display_order: 2 }),
      makePhoto({ id: 'p3', display_order: 3 }),
    ]
    const result = selectPoshmarkPhotos(photos, ['p3', 'p1'])
    assert.deepEqual(result.map((p) => p.id), ['p3', 'p1'])
  })
})

describe('buildUnifiedListingForPoshmark', () => {
  it('maps condition correctly', async () => {
    const photos = [makePhoto({})]
    const { unified } = await buildUnifiedListingForPoshmark(
      { ...baseListing, condition: 'like_new' } as unknown as Listing,
      photos
    )
    assert.equal(unified.condition, 'uln')
  })

  it('maps new_with_tags condition to nwt', async () => {
    const photos = [makePhoto({})]
    const { unified } = await buildUnifiedListingForPoshmark(
      { ...baseListing, condition: 'new_with_tags' } as unknown as Listing,
      photos
    )
    assert.equal(unified.condition, 'nwt')
  })

  it('maps good condition to ug', async () => {
    const photos = [makePhoto({})]
    const { unified } = await buildUnifiedListingForPoshmark(
      { ...baseListing, condition: 'good' } as unknown as Listing,
      photos
    )
    assert.equal(unified.condition, 'ug')
  })

  it('maps fair and poor to uf', async () => {
    const photos = [makePhoto({})]
    for (const cond of ['fair', 'poor'] as const) {
      const { unified } = await buildUnifiedListingForPoshmark(
        { ...baseListing, condition: cond } as unknown as Listing,
        photos
      )
      assert.equal(unified.condition, 'uf')
    }
  })

  it('throws when platform_fields.poshmark is missing', async () => {
    const listing = { ...baseListing, platform_fields: {} } as unknown as Listing
    await assert.rejects(
      () => buildUnifiedListingForPoshmark(listing, []),
      /platform_fields\.poshmark/
    )
  })

  it('throws when category is not in the map', async () => {
    const listing = {
      ...baseListing,
      platform_fields: {
        poshmark: { ...baseListing.platform_fields!.poshmark!, department: 'Men', category: 'NotARealCategory' },
      },
    } as unknown as Listing
    await assert.rejects(
      () => buildUnifiedListingForPoshmark(listing, [makePhoto({})]),
      /Unknown Poshmark category/
    )
  })

  it('uses final_price_cents when set', async () => {
    const listing = { ...baseListing, final_price_cents: 45000 } as unknown as Listing
    const { unified } = await buildUnifiedListingForPoshmark(listing, [makePhoto({})])
    assert.equal(unified.price, 45000)
  })

  it('falls back to suggested_price_cents when final_price_cents is null', async () => {
    const { unified } = await buildUnifiedListingForPoshmark(baseListing, [makePhoto({})])
    assert.equal(unified.price, 50000)
  })

  it('sets brand and internalId from listing', async () => {
    const { unified } = await buildUnifiedListingForPoshmark(baseListing, [makePhoto({})])
    assert.equal(unified.brand, 'Rolex')
    assert.equal(unified.internalId, 'WA-001')
  })

  it('sets extras.colors and styleTags from platform_fields', async () => {
    const { extras } = await buildUnifiedListingForPoshmark(baseListing, [makePhoto({})])
    assert.deepEqual(extras.colors, ['Black', 'Silver'])
    assert.deepEqual(extras.styleTags, ['Luxury', 'Classic', 'Diver'])
  })
})
