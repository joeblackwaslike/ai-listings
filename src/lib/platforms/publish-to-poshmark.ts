import type { SupabaseClient } from '@supabase/supabase-js'
import type { Listing, Photo, PlatformFields, ListingUrls } from '@/types/listings'
import type { UnifiedListing } from './types'
import { lookupPoshmarkCategory } from './poshmark-categories'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'

export interface PoshmarkPublishResult {
  platformId: string
  url: string
}

export interface PoshmarkPublisher {
  createListing(listing: UnifiedListing): Promise<{ platformId: string; url: string }>
}

export interface PoshmarkListingExtras {
  categoryIds: ReturnType<typeof lookupPoshmarkCategory>
  colors: string[]
  styleTags: string[]
  originalPriceCents: number | undefined
  minPriceCents: number | undefined
  smartSell: boolean
}

const POSHMARK_CONDITION_MAP: Record<string, string> = {
  new_with_tags: 'nwt',
  new_without_tags: 'uln',
  like_new: 'uln',
  very_good: 'ug',
  good: 'ug',
  fair: 'uf',
  poor: 'uf',
  for_parts: 'uf',
}

/**
 * Selects and orders photos for a Poshmark listing.
 * Studio photos come first (by display_order), auth_card photos appended at end.
 * Total capped at 16. If photoIds override is provided, uses that order instead.
 */
export function selectPoshmarkPhotos(photos: Photo[], photoIds?: string[]): Photo[] {
  if (photoIds && photoIds.length > 0) {
    const byId = new Map(photos.map((p) => [p.id, p]))
    return photoIds
      .map((id) => byId.get(id))
      .filter((p): p is Photo => p !== undefined)
      .slice(0, 16)
  }

  const studio = photos
    .filter((p) => p.type === 'studio')
    .sort((a, b) => a.display_order - b.display_order)

  const authCards = photos
    .filter((p) => p.type === 'auth_card')
    .sort((a, b) => a.display_order - b.display_order)

  const combined = [...studio, ...authCards]

  if (combined.length <= 16) return combined

  // If we have more than 16, always include at least 1 auth_card if any exist
  if (authCards.length > 0) {
    return [...studio.slice(0, 15), authCards[0]]
  }
  return studio.slice(0, 16)
}

export async function buildUnifiedListingForPoshmark(
  listing: Listing,
  photos: Photo[],
  options?: { photoIds?: string[] },
): Promise<{ unified: UnifiedListing; extras: PoshmarkListingExtras }> {
  const pm = listing.platform_fields?.poshmark
  if (!pm) throw new Error('platform_fields.poshmark is missing — run pipeline through step 4 first')

  const selectedPhotos = selectPoshmarkPhotos(photos, options?.photoIds)
  const imageUrls = await Promise.all(
    selectedPhotos
      .map((p) => p.processed_url ?? p.raw_url)
      .filter(Boolean)
      .map((url) => toPublicUrl(url as string))
  )

  const categoryIds = lookupPoshmarkCategory(pm.department, pm.category, pm.subcategory)

  const poshmarkCondition = (listing.condition ? POSHMARK_CONDITION_MAP[listing.condition] : undefined) ?? 'ug'

  const priceCents = listing.final_price_cents ?? listing.suggested_price_cents
  if (!priceCents || priceCents <= 0) {
    throw new Error('buildUnifiedListingForPoshmark: could not resolve a positive price')
  }

  const unified: UnifiedListing = {
    internalId: listing.sku ?? '',
    title: pm.title,
    description: pm.description,
    price: priceCents,
    condition: poshmarkCondition,
    category: pm.category,
    brand: listing.brand ?? '',
    imageUrls,
    platformFields: {
      department: pm.department,
      subcategory: pm.subcategory,
      size: pm.size,
    },
  }

  const extras: PoshmarkListingExtras = {
    categoryIds,
    colors: pm.colors ?? [],
    styleTags: pm.style_tags ?? [],
    originalPriceCents: pm.original_price_cents,
    minPriceCents: pm.min_price_cents,
    smartSell: pm.smart_sell ?? false,
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
  const { unified } = await buildUnifiedListingForPoshmark(listing, photos, { photoIds: options?.photoIds })

  if (draft) {
    return { platformId: '', url: '' }
  }

  const result = await adapter.createListing(unified)

  const currentPlatformFields = listing.platform_fields as PlatformFields
  const updatedPlatformFields: PlatformFields = {
    ...currentPlatformFields,
    poshmark: {
      ...currentPlatformFields.poshmark!,
      listing_id: result.platformId,
    },
  }
  const updatedListingUrls: ListingUrls = {
    ...(listing.listing_urls ?? {}),
    poshmark: result.url,
  }

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
