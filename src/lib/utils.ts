import type { Listing, Photo } from '@/types/listings'
import { detectIrregularRingStyle } from './jewelry-detection'

export function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(0)}`
}

export function relativeDate(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function detectClothingSubType(notableFeatures: string[]): import('@/types/listings').ClothingSubType | null {
  const model = notableFeatures.find((f) => f.startsWith('Model:'))?.slice(7).toLowerCase() ?? ''
  if (/\bjeans?\b|denim|\b5[0-9][0-9]\b/.test(model)) return 'jeans'
  if (/\bshorts?\b/.test(model)) return 'shorts'
  if (/formal.*pant|dress.*pant|trousers?|slacks?/.test(model)) return 'pants_formal'
  if (/\bpants?\b|\bchinos?\b|\bkhakis?\b/.test(model)) return 'pants'
  if (/t.?shirt|tee\b|crew.?neck/.test(model)) return 'tshirt'
  if (/\bshirt\b|button.?down|oxford|polo|dress\s+shirt/.test(model)) return 'shirt'
  if (/\bdress\b/.test(model)) return 'dress'
  if (/jacket|blazer|\bcoat\b|hoodie|sweatshirt/.test(model)) return 'jacket'
  if (/\bskirt\b/.test(model)) return 'skirt'
  return null
}

// Everything else (handbag, small_leather_goods, electronics, keyboards,
// collectibles, watches, jewelry sub-types with no dedicated fields, other, etc.) — 3D dimensions
const genericDimensionFields: import('@/types/listings').MeasurementField[] = [
  { key: 'width', label: 'Width', hint: 'in inches — side to side at the widest point' },
  { key: 'height', label: 'Height', hint: 'in inches — base to top' },
  { key: 'depth', label: 'Depth', hint: 'in inches — front to back' },
]

export function getMeasurementFields(
  category: string,
  subType: import('@/types/listings').ClothingSubType | import('@/types/listings').JewelrySubType | null,
  notableFeatures: string[] = []
): import('@/types/listings').MeasurementField[] {
  if (category === 'sneakers') {
    return [
      { key: 'shoe_size_system', label: 'Sizing System', hint: 'which system is printed on the tag', useChips: true, chipOptions: ['US', 'EU', 'UK'] },
      { key: 'shoe_size_raw', label: 'Size (as printed)', hint: 'e.g. 39, 6.5, 8.5' },
      { key: 'us_size', label: 'US Size (if directly on the tag)', hint: 'skip if only EU/UK is shown — this gets computed otherwise' },
      { key: 'item_length_in', label: 'Length', hint: 'one shoe of the pair — toe to heel, in inches' },
      { key: 'item_width_in', label: 'Width', hint: 'one shoe of the pair — side to side at the widest point, in inches' },
      { key: 'item_height_in', label: 'Height', hint: 'one shoe of the pair — base to top, in inches' },
    ]
  }
  if (category === 'jewelry') {
    const ringInscribedSizeField: import('@/types/listings').MeasurementField = {
      key: 'ring_inscribed_size',
      label: 'Inscribed Size (if stamped inside the band)',
      hint: 'worth checking with a magnifying glass — often present on precious-metal pieces, not universally reliable',
    }
    switch (subType) {
      case 'ring':
        if (detectIrregularRingStyle(notableFeatures)) {
          return [
            ringInscribedSizeField,
            { key: 'ring_id_widest_mm', label: 'Inner Diameter — Widest Point', hint: "mm, at the band's widest point" },
            { key: 'ring_id_narrowest_mm', label: 'Inner Diameter — Narrowest Point', hint: "mm, at the band's narrowest point" },
          ]
        }
        return [ringInscribedSizeField, { key: 'ring_id_mm', label: 'Inner Diameter', hint: 'mm, single reading' }]
      case 'bangle':
        return [{ key: 'bangle_id_mm', label: 'Inner Diameter', hint: 'mm' }]
      case 'necklace':
        return [{ key: 'necklace_chain_length_in', label: 'Chain Length', hint: 'inches' }]
      default:
        return genericDimensionFields
    }
  }
  if (category === 'clothing') {
    switch (subType) {
      case 'jeans':
      case 'pants':
        return [
          { key: 'waist', label: 'Waist', hint: 'in inches (e.g. 32)' },
          { key: 'inseam', label: 'Inseam', hint: 'in inches (e.g. 30)' },
        ]
      case 'pants_formal':
        return [
          { key: 'waist', label: 'Waist', hint: 'in inches' },
          { key: 'inseam', label: 'Inseam', hint: 'in inches' },
          { key: 'rise', label: 'Rise', hint: 'low, mid, or high', useChips: true, chipOptions: ['Low', 'Mid', 'High'] },
        ]
      case 'shorts':
        return [{ key: 'waist', label: 'Waist', hint: 'in inches' }]
      case 'tshirt':
        return [
          { key: 'chest', label: 'Chest', hint: 'lay flat across, double it (inches)' },
          { key: 'length', label: 'Length', hint: 'collar to hem (inches)' },
        ]
      case 'shirt':
      case 'jacket':
        return [
          { key: 'chest', label: 'Chest', hint: 'lay flat across, double it (inches)' },
          { key: 'sleeve', label: 'Sleeve', hint: 'neck to cuff (inches)' },
          { key: 'length', label: 'Length', hint: 'collar to hem (inches)' },
        ]
      case 'dress':
        return [
          { key: 'bust', label: 'Bust', hint: 'in inches' },
          { key: 'waist', label: 'Waist', hint: 'in inches' },
          { key: 'hips', label: 'Hips', hint: 'in inches' },
          { key: 'length', label: 'Length', hint: 'in inches' },
        ]
      case 'skirt':
        return [
          { key: 'waist', label: 'Waist', hint: 'in inches' },
          { key: 'length', label: 'Length', hint: 'in inches' },
        ]
      default:
        return [
          { key: 'chest', label: 'Chest', hint: 'in inches (if applicable)' },
          { key: 'length', label: 'Length', hint: 'in inches' },
        ]
    }
  }
  return genericDimensionFields
}

// Studio photos are "ready" for confirmation once their backgrounds are processed,
// or immediately when background removal is skipped (the originals are kept as-is).
export function studioPhotosReady(listing: Listing, photos: Photo[]): boolean {
  const studio = photos.filter((p) => p.type === 'studio')
  if (studio.length === 0) return false
  return listing.skip_background_removal || studio.every((p) => p.processed_url !== null)
}
