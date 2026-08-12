import type { Listing, Photo } from '@/types/listings';
import type { UnifiedListing } from './types';
import { toPublicUrl } from '@/lib/pipeline/to-public-url';

/**
 * Builds the platform-agnostic {@link UnifiedListing} the eBay adapter's `createListing`
 * expects, from a real `Listing` row + its `photos`.
 *
 * Title/description/item-specifics/category_id are pulled from `listing.platform_fields.ebay`
 * (the eBay-optimized copy produced by pipeline step 4a) rather than the listing's generic
 * top-level fields. `condition`, however, intentionally comes from the listing's top-level
 * `condition` (the internal `ConditionValue` enum, e.g. `'like_new'`) — NOT from
 * `platform_fields.ebay.condition_id`, which already holds eBay's numeric condition ID.
 * `EbayAdapter.createListing` re-derives the numeric condition ID itself via
 * `mapConditionToEbay`/`mapConditionIdToEbay`, both of which expect the internal enum; passing
 * `condition_id` straight through here would double-map an already-mapped value and silently
 * fall back to eBay's "GOOD"/2500 default for almost every listing.
 */
export async function buildUnifiedListingForEbay(
  listing: Listing,
  photos: Photo[],
): Promise<UnifiedListing> {
  const ebayFields = listing.platform_fields?.ebay;
  if (!ebayFields) {
    throw new Error(
      'buildUnifiedListingForEbay: listing has no platform_fields.ebay — run the pipeline through step 4 first',
    );
  }
  if (!listing.sku) {
    throw new Error('buildUnifiedListingForEbay: listing has no sku assigned yet');
  }

  const imageUrls = await Promise.all(
    photos
      .filter((p) => p.type === 'studio')
      .sort((a, b) => a.display_order - b.display_order)
      .map((p) => p.processed_url ?? p.raw_url)
      .map((url) => toPublicUrl(url)),
  );

  // Open question for Joe (not settled): nothing in the pipeline currently sets
  // final_price_cents before publish, so this falls back to suggested_price_cents (the AI
  // pricing-research estimate). Confirm whether posting to eBay should instead *require*
  // final_price_cents to be explicitly set first (e.g. after Joe reviews/adjusts the price)
  // rather than silently publishing at the AI-suggested price.
  const priceCents = listing.final_price_cents ?? listing.suggested_price_cents ?? 0;

  return {
    internalId: listing.sku,
    title: ebayFields.title,
    description: ebayFields.description,
    price: priceCents,
    condition: listing.condition ?? '',
    category: listing.category ?? '',
    brand: listing.brand ?? '',
    imageUrls,
    platformFields: {
      item_specifics: ebayFields.item_specifics,
      category_id: ebayFields.category_id,
    },
  };
}
