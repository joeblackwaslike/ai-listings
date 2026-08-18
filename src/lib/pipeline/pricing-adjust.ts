import type { AuthCardSource, ClothingSubType, Inclusion, JewelrySubType, Listing, ListingCategory, PricingComp } from '@/types/listings'
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

export interface AdjustedPricing {
  priceCents: number | null
  priceToMoveCents: number | null
  basePriceCents: number | null
  inclusionPremiumCents: number
  authenticityPremiumCents: number
  compCount: number
}

export type PricingListing = Pick<Listing, 'condition' | 'category' | 'sub_type' | 'inclusions'>

/**
 * The single source of truth for "what does this listing cost" — used for FieldsPanel display,
 * the eBay publish price, and the auto-discount cron's current-price fallback. Always
 * recomputed fresh from the listing's *current* condition/inclusions, never from data cached at
 * step3 gather-time, so it self-heals when condition-reassessment flips condition_confirmed
 * back to false post-intake — see condition-reassessment.ts. `includePremiums: false`
 * reproduces step3's original comps+condition-only estimate; `includePremiums: true` layers on
 * inclusion + authenticity premiums, both computed off the pre-premium base price so they can't
 * create a circular price-tier lookup.
 *
 * When there are no sold comps, priceCents stays null (no comp-derived base to layer premiums
 * onto) rather than falling back to step4a's suggested_price_cents as a premium base: step4a's
 * prompt lists every *detected* inclusion (not just confirmed ones) when asking the model for
 * that estimate, so the model's price may already reflect them -- adding a fixed premium on top
 * risks double-counting a confirmed item, or leaving a rejected item's value embedded in the
 * base with no way to back it out. resolveFinalPriceCents still falls back to the raw
 * suggested_price_cents (unpremiumed) for display/publish in this case.
 */
export function computeAdjustedPricing(
  listing: PricingListing,
  comps: PricingComp[],
  opts: { includePremiums: boolean }
): AdjustedPricing {
  const soldComps = comps.filter((c) => !c.source.endsWith('_active'))
  const adjustedCompPrices = soldComps
    .map((c) => adjustForCondition(c.sale_price_cents, conditionDelta(listing.condition ?? '', c.condition)))
    .sort((a, b) => a - b)

  const mid = Math.floor(adjustedCompPrices.length / 2)
  const basePriceCents =
    adjustedCompPrices.length === 0
      ? null
      : adjustedCompPrices.length % 2 === 0
        ? Math.round((adjustedCompPrices[mid - 1] + adjustedCompPrices[mid]) / 2)
        : adjustedCompPrices[mid]

  const inclusionPremium =
    opts.includePremiums && basePriceCents != null
      ? inclusionPremiumCents(listing.category, listing.sub_type, listing.inclusions, basePriceCents)
      : 0
  const authPremium =
    opts.includePremiums && basePriceCents != null
      ? authenticityPremiumCents(listing.category, listing.sub_type, listing.inclusions, basePriceCents)
      : 0

  const priceCents = basePriceCents == null ? null : basePriceCents + inclusionPremium + authPremium

  const discountPct = CATEGORY_DISCOUNT[listing.category?.toLowerCase() ?? ''] ?? 0.18
  const priceToMoveCents = priceCents == null ? null : Math.round(priceCents * (1 - discountPct))

  return {
    priceCents,
    priceToMoveCents,
    basePriceCents,
    inclusionPremiumCents: inclusionPremium,
    authenticityPremiumCents: authPremium,
    compCount: soldComps.length,
  }
}

/**
 * The pricing gate: true once condition and every inclusion are confirmed, meaning
 * computeAdjustedPricing can safely be called with includePremiums: true. Shared by
 * FieldsPanel display, the finalize-route gate, the eBay publish price, and the
 * auto-discount cron — do not re-derive this boolean inline at new call sites.
 */
export function isPricingGateUnlocked(
  listing: Pick<Listing, 'condition_confirmed' | 'inclusions'>
): boolean {
  return listing.condition_confirmed && listing.inclusions.every((i) => i.confirmed)
}

/**
 * The actual price a listing will publish/display at: an explicit final_price_cents override
 * always wins; otherwise computeAdjustedPricing's result; otherwise suggested_price_cents
 * (step4a's model-estimated fallback for the zero-comps case). Shared by the eBay publish path
 * and the Publish Export page display -- do not re-derive this chain inline at new call sites,
 * or the displayed price can silently diverge from what actually gets published (found via
 * code review on PR #49: the Export page originally showed only computeAdjustedPricing's raw
 * result, missing both the final_price_cents override and the suggested_price_cents fallback).
 */
export function resolveFinalPriceCents(
  listing: Pick<Listing, 'final_price_cents' | 'suggested_price_cents'>,
  adjusted: Pick<AdjustedPricing, 'priceCents'>
): number | null {
  return listing.final_price_cents ?? adjusted.priceCents ?? listing.suggested_price_cents
}
