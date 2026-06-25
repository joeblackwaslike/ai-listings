import type { Listing, Photo } from '@/types/listings'

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

export function getMeasurementFields(
  category: string,
  subType: import('@/types/listings').ClothingSubType | null
): import('@/types/listings').MeasurementField[] {
  if (category === 'sneakers') {
    return [{ key: 'us_size', label: 'US Size', hint: 'e.g. 9.5' }]
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
  // Everything else (handbag, small_leather_goods, electronics, keyboards,
  // collectibles, watches, jewelry, other, etc.) — 3D dimensions
  return [
    { key: 'height', label: 'Height', hint: 'in inches' },
    { key: 'width', label: 'Width', hint: 'in inches' },
    { key: 'depth', label: 'Depth', hint: 'in inches' },
  ]
}

// Studio photos are "ready" for confirmation once their backgrounds are processed,
// or immediately when background removal is skipped (the originals are kept as-is).
export function studioPhotosReady(listing: Listing, photos: Photo[]): boolean {
  const studio = photos.filter((p) => p.type === 'studio')
  if (studio.length === 0) return false
  return listing.skip_background_removal || studio.every((p) => p.processed_url !== null)
}
