import type { AuthCardSource, ClothingSubType, Inclusion, JewelrySubType, ListingCategory } from '@/types/listings'
import { getInclusionChecklist } from '@/lib/inclusions'

export function conditionDelta(
  listingCondition: string,
  compCondition: string
): 'same' | 'better' | 'worse' {
  const conditionRank: Record<string, number> = {
    new_with_tags: 8,
    new_without_tags: 7,
    like_new: 6,
    very_good: 5,
    good: 4,
    fair: 3,
    poor: 2,
    for_parts: 1,
  }
  const listingRank = conditionRank[listingCondition] ?? 4
  const compRank = compCondition.toLowerCase().includes('like new')
    ? 6
    : compCondition.toLowerCase().includes('good')
      ? 4
      : compCondition.toLowerCase().includes('new')
        ? 7
        : 4

  if (listingRank > compRank) return 'better'
  if (listingRank < compRank) return 'worse'
  return 'same'
}

export function adjustForCondition(priceCents: number, delta: 'same' | 'better' | 'worse'): number {
  if (delta === 'better') return Math.round(priceCents * 1.15)
  if (delta === 'worse') return Math.round(priceCents * 0.85)
  return priceCents
}

export const CATEGORY_DISCOUNT: Record<string, number> = {
  handbag: 0.15,
  watches: 0.12,
  electronics: 0.20,
  clothing: 0.25,
  sneakers: 0.20,
  jewelry: 0.15,
  small_leather_goods: 0.18,
  keyboards: 0.15,
  collectibles: 0.15,
}

export type PriceTier = 'low' | 'mid' | 'high'

export function priceTierOf(priceCents: number): PriceTier {
  if (priceCents < 15_000) return 'low'
  if (priceCents < 75_000) return 'mid'
  return 'high'
}

const BASE_ITEM_PREMIUMS: Record<string, Record<PriceTier, number>> = {
  'Original box': { low: 400, mid: 1000, high: 2500 },
  'Dust bag/cover': { low: 250, mid: 600, high: 1200 },
  'Receipt': { low: 250, mid: 400, high: 700 },
}

const INCLUSION_PREMIUM_CENTS: Partial<Record<ListingCategory, Record<string, Record<PriceTier, number>>>> = {
  handbag: {
    'Original box': { low: 800, mid: 2000, high: 5000 },
    'Dust bag/cover': { low: 500, mid: 1500, high: 3500 },
    'Shop bag': { low: 300, mid: 800, high: 1500 },
    'Brand tag': { low: 500, mid: 1500, high: 3500 },
    'Reseller tag/UPC': { low: 300, mid: 800, high: 1500 },
    'Receipt': { low: 300, mid: 500, high: 1000 },
  },
  small_leather_goods: {
    'Original box': { low: 800, mid: 2000, high: 5000 },
    'Dust bag/cover': { low: 500, mid: 1500, high: 3500 },
    'Shop bag': { low: 300, mid: 800, high: 1500 },
    'Brand tag': { low: 500, mid: 1500, high: 3500 },
    'Reseller tag/UPC': { low: 300, mid: 800, high: 1500 },
    'Receipt': { low: 300, mid: 500, high: 1000 },
  },
  watches: {
    'Original box': { low: 1000, mid: 2500, high: 7500 },
    'Dust bag/cover': { low: 500, mid: 1000, high: 2500 },
    'Warranty/registration card': { low: 800, mid: 2000, high: 5000 },
    'Instruction booklet': { low: 500, mid: 1000, high: 2000 },
    'Receipt': { low: 500, mid: 800, high: 1500 },
  },
  sneakers: {
    'Original box': { low: 800, mid: 1500, high: 3000 },
    'Dust bag/cover': { low: 300, mid: 600, high: 1200 },
    'Extra shoelaces': { low: 300, mid: 500, high: 800 },
    'Brand tag': { low: 500, mid: 1000, high: 2000 },
    'Shop bag': { low: 300, mid: 500, high: 1000 },
    'Receipt': { low: 200, mid: 400, high: 800 },
  },
}

/**
 * Dollar premium for a listing's confirmed inclusions at its base (pre-premium) price tier.
 * Categories without a custom table (jewelry, electronics, clothing, keyboards, collectibles,
 * other) fall back to BASE_ITEM_PREMIUMS. The authenticity card is deliberately excluded here —
 * see authenticityPremiumCents (a later task) — to avoid double-counting it as both a generic
 * item and an authenticity signal. Figures are illustrative starting constants, not sourced
 * market data; tune once real conversion data exists.
 */
export function inclusionPremiumCents(
  category: ListingCategory | null,
  subType: ClothingSubType | JewelrySubType | null,
  inclusions: Inclusion[],
  basePriceCents: number
): number {
  const cat = category ?? 'other'
  const tier = priceTierOf(basePriceCents)
  const checklist = getInclusionChecklist(cat, subType)
  const checklistByName = new Map(checklist.map((c) => [c.item.trim().toLowerCase(), c]))

  return inclusions
    .filter((i) => i.confirmed)
    .reduce((sum, item) => {
      const entry = checklistByName.get(item.item.trim().toLowerCase())
      if (!entry || entry.isAuthCard) return sum

      const table = INCLUSION_PREMIUM_CENTS[cat]?.[entry.item] ?? BASE_ITEM_PREMIUMS[entry.item]
      if (!table) return sum

      // tagState is 'attached' | 'severed' | undefined; anything other than 'severed' gets full premium
      const premium = entry.isTag && item.tagState === 'severed' ? Math.round(table[tier] / 2) : table[tier]
      return sum + premium
    }, 0)
}

const AUTH_THRESHOLD_CENTS: Partial<Record<ListingCategory, number>> = {
  jewelry: 50_000,
  sneakers: 7_500,
  collectibles: 20_000,
  handbag: 50_000,
  small_leather_goods: 50_000,
}

const AUTHENTICITY_PREMIUM_CENTS: Record<AuthCardSource, Record<PriceTier, number>> = {
  original: { low: 500, mid: 2000, high: 5000 },
  reseller: { low: 300, mid: 1000, high: 2500 },
  third_party: { low: 200, mid: 600, high: 1500 },
}

/**
 * Below the category's mandatory-authentication threshold (eBay Authenticity Guarantee /
 * Poshmark Posh Authenticate — see the design doc for sourced figures), the seller's own
 * authenticity documentation is the only signal a buyer has, so it adds value. At/above
 * threshold the platform authenticates independently regardless of docSource, so the premium
 * drops to $0 (hard cutoff, not a taper). Categories with no documented threshold always apply
 * the premium.
 */
export function authenticityPremiumCents(
  category: ListingCategory | null,
  subType: ClothingSubType | JewelrySubType | null,
  inclusions: Inclusion[],
  basePriceCents: number
): number {
  const cat = category ?? 'other'
  const checklist = getInclusionChecklist(cat, subType)
  const authCardEntry = checklist.find((c) => c.isAuthCard)
  if (!authCardEntry) return 0

  const card = inclusions.find(
    (i) => i.confirmed && i.item.trim().toLowerCase() === authCardEntry.item.trim().toLowerCase()
  )
  if (!card?.docSource) return 0

  const threshold = AUTH_THRESHOLD_CENTS[cat]
  if (threshold != null && basePriceCents >= threshold) return 0

  return AUTHENTICITY_PREMIUM_CENTS[card.docSource][priceTierOf(basePriceCents)]
}
