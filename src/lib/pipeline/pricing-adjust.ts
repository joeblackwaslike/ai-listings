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
