import type { SupabaseClient } from '@supabase/supabase-js'
import type { Listing, Photo, PlatformFields, ListingUrls } from '@/types/listings'
import type { UnifiedListing } from './types'
import { POSHMARK_CATEGORY_MAP } from './poshmark-categories'
import { PlatformError } from './errors'

export interface PoshmarkPublishResult {
  platformId: string
  url: string
}

export interface PoshmarkPublisher {
  createListing(listing: UnifiedListing): Promise<PoshmarkPublishResult>
}

const CONDITION_MAP: Record<string, string> = {
  new_with_tags: 'nwt',
  new_without_tags: 'nwot',
  like_new: 'uln',
  very_good: 'uln',
  good: 'ug',
  fair: 'uf',
  poor: 'uf',
}

export function selectPoshmarkPhotos(photos: Photo[], photoIds?: string[]): Photo[] {
  if (photoIds?.length) {
    const byId = new Map(photos.map((p) => [p.id, p]))
    return photoIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  }
  const studio = photos
    .filter((p) => p.type === 'studio')
    .sort((a, b) => a.display_order - b.display_order)
  const auth = photos
    .filter((p) => p.type === 'auth_card')
    .sort((a, b) => a.display_order - b.display_order)
  return [...studio.slice(0, 16 - auth.length), ...auth]
}

export interface UnifiedListingExtras {
  colors: string[]
  styleTags: string[]
  categoryIds: { departmentId: string; categoryId: string; subcategoryId?: string }
}

export async function buildUnifiedListingForPoshmark(
  listing: Listing,
  photos: Photo[],
): Promise<{ unified: UnifiedListing; extras: UnifiedListingExtras }> {
  const pm = (listing.platform_fields as PlatformFields)?.poshmark
  if (!pm) {
    throw new Error('buildUnifiedListingForPoshmark: platform_fields.poshmark missing — run pipeline step 4 first')
  }

  const priceCents = listing.final_price_cents ?? listing.suggested_price_cents
  if (!priceCents || priceCents <= 0) {
    throw new Error('buildUnifiedListingForPoshmark: no valid price')
  }

  const categoryKey = pm.subcategory
    ? `${pm.department}/${pm.category}/${pm.subcategory}`
    : `${pm.department}/${pm.category}`
  const categoryIds = POSHMARK_CATEGORY_MAP[categoryKey]
  if (!categoryIds) {
    throw new PlatformError('poshmark', `Unknown Poshmark category path: "${categoryKey}" — re-run step 4`)
  }

  const extras: UnifiedListingExtras = {
    colors: pm.colors ?? [],
    styleTags: pm.style_tags ?? [],
    categoryIds,
  }

  const unified: UnifiedListing = {
    internalId: listing.sku ?? '',
    title: pm.title,
    description: pm.description,
    price: priceCents,
    condition: CONDITION_MAP[listing.condition ?? ''] ?? 'ug',
    category: categoryKey,
    brand: listing.brand ?? '',
    imageUrls: photos.map((p) => p.processed_url ?? p.raw_url),
    platformFields: {
      categoryIds,
      colors: extras.colors,
      styleTags: extras.styleTags,
      size: pm.size,
      originalPriceCents: pm.original_price_cents,
      minPriceCents: pm.min_price_cents,
      smartSell: pm.smart_sell,
    },
  }

  return { unified, extras }
}

export async function publishListingToPoshmark(
  supabase: SupabaseClient,
  listing: Listing,
  photos: Photo[],
  adapter: PoshmarkPublisher,
  options?: { draft?: boolean; photoIds?: string[] },
): Promise<PoshmarkPublishResult> {
  const draft = options?.draft ?? false
  const selected = selectPoshmarkPhotos(photos, options?.photoIds)
  const { unified } = await buildUnifiedListingForPoshmark(listing, selected)
  const result = await adapter.createListing(unified)

  const currentPlatformFields = (listing.platform_fields ?? {}) as PlatformFields
  const updatedPlatformFields: PlatformFields = {
    ...currentPlatformFields,
    poshmark: { ...currentPlatformFields.poshmark!, listing_id: result.platformId },
  }

  if (draft) {
    const { error } = await supabase
      .from('listings')
      .update({ platform_fields: updatedPlatformFields })
      .eq('id', listing.id)
    if (error) {
      throw new Error(`publishListingToPoshmark: failed to save draft platform ID — ${error.message}`)
    }
    return result
  }

  const updatedListingUrls: ListingUrls = { ...(listing.listing_urls ?? {}), poshmark: result.url }
  const { error: updateError } = await supabase
    .from('listings')
    .update({
      listing_urls: updatedListingUrls,
      status: 'published',
      platform_fields: updatedPlatformFields,
    })
    .eq('id', listing.id)

  if (updateError) {
    throw new Error(`publishListingToPoshmark: failed to update listing — ${updateError.message}`)
  }

  try {
    const { error: priceEventError } = await supabase.from('platform_price_events').insert({
      listing_id: listing.id,
      platform: 'poshmark',
      event_type: 'published',
      price_cents: unified.price,
    })
    if (priceEventError) {
      console.error(`publishListingToPoshmark: failed to record platform_price_events — ${priceEventError.message}`)
    }
  } catch (err) {
    console.error('publishListingToPoshmark: failed to record platform_price_events', err)
  }

  return result
}
