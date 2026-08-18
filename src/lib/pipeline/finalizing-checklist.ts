import type { Inclusion, Listing, ListingCategory } from '@/types/listings'

// "handbags, watches, heavier collectibles/electronics/keyboards" per ai-listings-6wb --
// jewelry and sneakers are always light enough not to matter and are excluded on purpose.
export const HEAVY_ITEM_CATEGORIES: ReadonlySet<ListingCategory> = new Set([
  'handbag',
  'watches',
  'collectibles',
  'electronics',
  'keyboards',
])

export function hasIncludedBox(inclusions: Inclusion[]): boolean {
  return inclusions.some((i) => i.confirmed && /box/i.test(i.item))
}

export function needsBoxMeasurement(listing: Pick<Listing, 'inclusions' | 'measurements'>): boolean {
  if (!hasIncludedBox(listing.inclusions)) return false
  const m = listing.measurements
  return !(m?.box_length_in != null && m?.box_width_in != null && m?.box_height_in != null)
}

export function needsWeight(listing: Pick<Listing, 'category' | 'measurements'>): boolean {
  if (!listing.category || !HEAVY_ITEM_CATEGORIES.has(listing.category)) return false
  return listing.measurements?.weight_oz == null
}
