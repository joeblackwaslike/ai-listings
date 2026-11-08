import { test } from 'node:test'
import assert from 'node:assert/strict'
import { delistFromOtherPlatforms, isPoshmarkAlreadyGone } from '@/lib/platforms/delist-sold'
import { PlatformError } from '@/lib/platforms/errors'
import type { ListingUrls, PlatformFields } from '@/types/listings'

const platformFields = {
  ebay: { ebay_offer_id: 'offer-1' },
  poshmark: { listing_id: 'posh-1' },
} as PlatformFields

function setup(overrides: Partial<Record<'ebay' | 'poshmark', () => Promise<void>>> = {}) {
  const calls: string[] = []
  const saved: ListingUrls[] = []
  const delisters = {
    ebay: async (pf: PlatformFields) => {
      calls.push(`ebay:${pf.ebay?.ebay_offer_id}`)
      await overrides.ebay?.()
    },
    poshmark: async (pf: PlatformFields) => {
      calls.push(`poshmark:${pf.poshmark?.listing_id}`)
      await overrides.poshmark?.()
    },
  }
  const saveUrls = async (urls: ListingUrls) => {
    saved.push({ ...urls })
  }
  return { calls, saved, delisters, saveUrls }
}

test('delists every published platform except the one it sold on, saving after each', async () => {
  const { calls, saved, delisters, saveUrls } = setup()
  const listing = { listing_urls: { ebay: 'e', poshmark: 'p' }, platform_fields: platformFields }

  const done = await delistFromOtherPlatforms(listing, 'ebay', delisters, saveUrls)

  assert.deepEqual(done, ['poshmark'])
  assert.deepEqual(calls, ['poshmark:posh-1'])
  assert.deepEqual(saved, [{ ebay: 'e' }])
})

test('keeps earlier delists saved when a later platform throws', async () => {
  const { saved, delisters, saveUrls } = setup({
    poshmark: async () => {
      throw new Error('boom')
    },
  })
  const listing = { listing_urls: { ebay: 'e', poshmark: 'p', mercari: 'm' }, platform_fields: platformFields }
  const withMercari = { ...delisters, mercari: async () => {} }

  await assert.rejects(delistFromOtherPlatforms(listing, 'mercari', withMercari, saveUrls), /boom/)
  assert.deepEqual(saved, [{ poshmark: 'p', mercari: 'm' }])
})

test('does not mutate the listing_urls it was given', async () => {
  const { delisters, saveUrls } = setup()
  const listing = { listing_urls: { ebay: 'e', poshmark: 'p' }, platform_fields: platformFields }

  await delistFromOtherPlatforms(listing, 'poshmark', delisters, saveUrls)

  assert.deepEqual(listing.listing_urls, { ebay: 'e', poshmark: 'p' })
})

test('isPoshmarkAlreadyGone recognises an HTTP 404 and nothing else', () => {
  assert.equal(isPoshmarkAlreadyGone(new PlatformError('poshmark', 'Poshmark request failed with HTTP 404')), true)
  assert.equal(isPoshmarkAlreadyGone(new PlatformError('poshmark', 'Poshmark request failed with HTTP 500')), false)
  assert.equal(isPoshmarkAlreadyGone('HTTP 404'), false)
})
