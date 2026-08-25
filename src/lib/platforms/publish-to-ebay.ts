import type { SupabaseClient } from '@supabase/supabase-js'
import type { Listing, Photo, PricingComp, PlatformFields, ListingUrls } from '@/types/listings'
import type { UnifiedListing } from './types'
import { buildUnifiedListingForEbay } from './unified-listing'

export interface EbayPublishResult {
  platformId: string
  offerId: string
  url: string
}

export interface EbayPublisher {
  createListing(
    listing: UnifiedListing,
    options?: { publish?: boolean },
  ): Promise<EbayPublishResult>
}

/**
 * Publishes a listing live to eBay: builds the {@link UnifiedListing}, calls the adapter's
 * `createListing`, then updates the listings row (platform IDs, URL, status) and records a
 * `platform_price_events` row (migration 0033) with the price actually sent to eBay.
 *
 * `platform_price_events` is a genuine external data point -- what was actually posted live --
 * distinct from `listing_price_events`, which only ever tracks changes to our own
 * `suggested_price_cents`/`final_price_cents` fields and never reflects what a platform
 * actually received. Recording it here, at the only call site that talks to eBay's API, is
 * the one place the real posted price is known.
 *
 * A failure recording the price event is logged but never thrown -- the listing has already
 * published successfully by that point, and losing this data point must not turn a successful
 * publish into a reported failure.
 */
export async function publishListingToEbay(
  supabase: SupabaseClient,
  listing: Listing,
  photos: Photo[],
  comps: PricingComp[],
  adapter: EbayPublisher,
): Promise<EbayPublishResult> {
  const unifiedListing = await buildUnifiedListingForEbay(listing, photos, comps)
  const result = await adapter.createListing(unifiedListing)

  const currentPlatformFields = listing.platform_fields as PlatformFields
  const updatedPlatformFields: PlatformFields = {
    ...currentPlatformFields,
    ebay: {
      ...currentPlatformFields.ebay!,
      ebay_listing_id: result.platformId,
      ebay_offer_id: result.offerId,
    },
  }
  const updatedListingUrls: ListingUrls = { ...(listing.listing_urls ?? {}), ebay: result.url }

  const { error: updateError } = await supabase
    .from('listings')
    .update({
      listing_urls: updatedListingUrls,
      status: 'published',
      platform_fields: updatedPlatformFields,
    })
    .eq('id', listing.id)

  if (updateError) {
    throw new Error(`publishListingToEbay: failed to update listing — ${updateError.message}`)
  }

  try {
    const { error: priceEventError } = await supabase.from('platform_price_events').insert({
      listing_id: listing.id,
      platform: 'ebay',
      event_type: 'published',
      price_cents: unifiedListing.price,
    })
    if (priceEventError) {
      console.error(`publishListingToEbay: failed to record platform_price_events — ${priceEventError.message}`)
    }
  } catch (err) {
    console.error('publishListingToEbay: failed to record platform_price_events', err)
  }

  return result
}
