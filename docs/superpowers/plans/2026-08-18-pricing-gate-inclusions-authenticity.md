# Pricing Gate: Condition + Inclusions Confirmation, Inclusion Premiums, Authenticity Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the *final, priced* suggested price behind confirmed condition + confirmed inclusions, add inclusion dollar premiums and authenticity-threshold-aware pricing, and route the resulting number through every place that currently reads the raw AI-suggested price (FieldsPanel display, eBay publish, auto-discount cron) — resolving both the finalize-route interim gate and the dormant `final_price_cents` fallback found during design.

**Architecture:** One new pure module, `src/lib/pipeline/pricing-adjust.ts`, exports `computeAdjustedPricing(listing, comps, { includePremiums })`. It recomputes condition delta from each comp's raw stored `condition` text against the listing's *current* `condition` column (fixing a staleness gap where condition re-assessment never re-triggers pricing), then optionally layers on inclusion + authenticity dollar premiums. Every consumer that previously read `listing.suggested_price_cents` as "the price" switches to calling this function instead.

**Tech Stack:** TypeScript, Next.js App Router, Supabase, `node:test` + `node:assert/strict` (this repo's existing test runner — see `src/lib/inclusions.test.ts` for the established style).

**Design doc:** [docs/superpowers/specs/2026-08-18-pricing-gate-inclusions-authenticity-design.md](docs/superpowers/specs/2026-08-18-pricing-gate-inclusions-authenticity-design.md)

---

## Task 1: `pricing-adjust.ts` — condition delta + price tiers (TDD)

**Files:**
- Create: `src/lib/pipeline/pricing-adjust.ts`
- Test: `src/lib/pipeline/pricing-adjust.test.ts`

This task ports `conditionDelta`/`adjustForCondition`/`CATEGORY_DISCOUNT` out of `step3-pricing-research.ts:413-445,684-694` unchanged, and adds `priceTierOf`. Task 2 will remove the originals from step3 and import from here instead.

- [x] **Step 1: Write the failing tests**

Create `src/lib/pipeline/pricing-adjust.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionDelta, adjustForCondition, priceTierOf, CATEGORY_DISCOUNT } from './pricing-adjust'

test('conditionDelta: listing better than comp condition', () => {
  assert.equal(conditionDelta('like_new', 'Good'), 'better')
})

test('conditionDelta: listing worse than comp condition', () => {
  assert.equal(conditionDelta('fair', 'Like new'), 'worse')
})

test('conditionDelta: same rank returns same', () => {
  assert.equal(conditionDelta('good', 'Not specified'), 'same')
})

test('conditionDelta: unknown listing condition defaults to good (rank 4)', () => {
  assert.equal(conditionDelta('', 'Not specified'), 'same')
})

test('adjustForCondition: better applies +15%', () => {
  assert.equal(adjustForCondition(10000, 'better'), 11500)
})

test('adjustForCondition: worse applies -15%', () => {
  assert.equal(adjustForCondition(10000, 'worse'), 8500)
})

test('adjustForCondition: same is unchanged', () => {
  assert.equal(adjustForCondition(10000, 'same'), 10000)
})

test('CATEGORY_DISCOUNT: has an entry for every known category', () => {
  assert.equal(CATEGORY_DISCOUNT.handbag, 0.15)
  assert.equal(CATEGORY_DISCOUNT.electronics, 0.20)
})

test('priceTierOf: boundaries', () => {
  assert.equal(priceTierOf(0), 'low')
  assert.equal(priceTierOf(14_999), 'low')
  assert.equal(priceTierOf(15_000), 'mid')
  assert.equal(priceTierOf(74_999), 'mid')
  assert.equal(priceTierOf(75_000), 'high')
  assert.equal(priceTierOf(1_000_000), 'high')
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: FAIL — `Cannot find module './pricing-adjust'` (file doesn't exist yet).

- [x] **Step 3: Write the module (condition delta + tiers only for now)**

Create `src/lib/pipeline/pricing-adjust.ts`:

```ts
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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: PASS, all 9 tests green.

- [x] **Step 5: Commit**

```bash
git add src/lib/pipeline/pricing-adjust.ts src/lib/pipeline/pricing-adjust.test.ts
git commit -m "feat(pricing-adjust): condition delta, category discount, price tiers"
```

---

## Task 2: `pricing-adjust.ts` — inclusion item premiums (TDD)

**Files:**
- Modify: `src/lib/pipeline/pricing-adjust.ts`
- Modify: `src/lib/pipeline/pricing-adjust.test.ts`

Uses `getInclusionChecklist` from `src/lib/inclusions.ts` (already reviewed — checklist items: `'Original box'`, `'Dust bag/cover'`, `'Authenticity card'` (`isAuthCard: true`), `'Receipt'` for all categories, plus category-specific additions for `sneakers`/`watches`/`handbag`/`small_leather_goods`; `'Brand tag'` is `isTag: true` where present).

- [x] **Step 1: Write the failing tests**

Append to `src/lib/pipeline/pricing-adjust.test.ts`:

```ts
import { inclusionPremiumCents } from './pricing-adjust'
import type { Inclusion } from '@/types/listings'

function inclusion(item: string, overrides: Partial<Inclusion> = {}): Inclusion {
  return { item, source: 'detected', confirmed: true, notes: null, ...overrides }
}

test('inclusionPremiumCents: sums confirmed matched items at the mid tier for handbag', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box'), inclusion('Dust bag/cover')],
    30_000 // mid tier
  )
  assert.equal(cents, 2000 + 1500) // handbag mid: box 2000, dust bag 1500
})

test('inclusionPremiumCents: unconfirmed items contribute nothing', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box', { confirmed: false })],
    30_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: unmatched free-text manual item contributes $0', () => {
  const cents = inclusionPremiumCents(
    'jewelry',
    null,
    [inclusion('Custom velvet pouch', { source: 'manual' })],
    10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: severed brand tag is halved vs. attached', () => {
  const attached = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'attached' })], 10_000 // low tier
  )
  const severed = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'severed' })], 10_000
  )
  assert.equal(attached, 500) // sneakers low: brand tag 500
  assert.equal(severed, 250)
})

test('inclusionPremiumCents: the authenticity card itself contributes $0 here (handled separately)', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Authenticity card', { docSource: 'original' })], 10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: categories without a custom table fall back to the base item table', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Original box')], 10_000 // low tier
  )
  assert.equal(cents, 400) // BASE_ITEM_PREMIUMS low
})

test('inclusionPremiumCents: matching is case-insensitive', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('original BOX')], 10_000
  )
  assert.equal(cents, 400)
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: FAIL — `inclusionPremiumCents is not a function` / TS error (not exported yet).

- [x] **Step 3: Implement `inclusionPremiumCents`**

Add to `src/lib/pipeline/pricing-adjust.ts` (after the `priceTierOf` block from Task 1):

```ts
import type { ClothingSubType, Inclusion, JewelrySubType, ListingCategory } from '@/types/listings'
import { getInclusionChecklist } from '@/lib/inclusions'

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
 * see authenticityPremiumCents — to avoid double-counting it as both a generic item and an
 * authenticity signal. Figures are illustrative starting constants, not sourced market data;
 * tune once real conversion data exists.
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

      const premium = entry.isTag && item.tagState === 'severed' ? Math.round(table[tier] / 2) : table[tier]
      return sum + premium
    }, 0)
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: PASS, all tests green (16 total so far).

- [x] **Step 5: Commit**

```bash
git add src/lib/pipeline/pricing-adjust.ts src/lib/pipeline/pricing-adjust.test.ts
git commit -m "feat(pricing-adjust): inclusion dollar premiums by category/tier"
```

---

## Task 3: `pricing-adjust.ts` — authenticity premium (TDD)

**Files:**
- Modify: `src/lib/pipeline/pricing-adjust.ts`
- Modify: `src/lib/pipeline/pricing-adjust.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `src/lib/pipeline/pricing-adjust.test.ts`:

```ts
import { authenticityPremiumCents } from './pricing-adjust'

test('authenticityPremiumCents: original docSource below threshold applies premium', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original' })],
    10_000 // low tier, below jewelry's $500 threshold
  )
  assert.equal(cents, 500) // original, low tier
})

test('authenticityPremiumCents: at or above the category threshold, premium is $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original' })],
    50_000 // exactly at jewelry's $500 threshold
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: category with no documented threshold always applies', () => {
  const cents = authenticityPremiumCents(
    'watches', null,
    [inclusion('Authenticity card', { docSource: 'reseller' })],
    200_000 // very high price — watches has no threshold entry
  )
  assert.equal(cents, 2500) // reseller, high tier
})

test('authenticityPremiumCents: no confirmed authenticity card returns $0', () => {
  const cents = authenticityPremiumCents('jewelry', null, [], 10_000)
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: confirmed card with no docSource returns $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null, [inclusion('Authenticity card')], 10_000
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: unconfirmed authenticity card returns $0', () => {
  const cents = authenticityPremiumCents(
    'jewelry', null,
    [inclusion('Authenticity card', { docSource: 'original', confirmed: false })],
    10_000
  )
  assert.equal(cents, 0)
})

test('authenticityPremiumCents: third_party docSource scales by tier', () => {
  const low = authenticityPremiumCents('sneakers', null, [inclusion('Authenticity card', { docSource: 'third_party' })], 5_000)
  const mid = authenticityPremiumCents('watches', null, [inclusion('Authenticity card', { docSource: 'third_party' })], 30_000)
  assert.equal(low, 200)
  assert.equal(mid, 600)
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: FAIL — `authenticityPremiumCents is not a function`.

- [x] **Step 3: Implement `authenticityPremiumCents`**

Add to `src/lib/pipeline/pricing-adjust.ts` (after `inclusionPremiumCents`):

```ts
import type { AuthCardSource } from '@/types/listings'

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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: PASS, all tests green (23 total so far).

- [x] **Step 5: Commit**

```bash
git add src/lib/pipeline/pricing-adjust.ts src/lib/pipeline/pricing-adjust.test.ts
git commit -m "feat(pricing-adjust): authenticity-threshold-aware pricing premium"
```

---

## Task 4: `pricing-adjust.ts` — `computeAdjustedPricing` integration (TDD)

**Files:**
- Modify: `src/lib/pipeline/pricing-adjust.ts`
- Modify: `src/lib/pipeline/pricing-adjust.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `src/lib/pipeline/pricing-adjust.test.ts`:

```ts
import { computeAdjustedPricing } from './pricing-adjust'
import type { PricingComp } from '@/types/listings'

function comp(overrides: Partial<PricingComp> = {}): PricingComp {
  return {
    id: 'comp-1', listing_id: 'listing-1', source: 'ebay', title: 'Test comp',
    sale_price_cents: 10_000, condition: 'Not specified', sold_at: '2026-01-01T00:00:00Z',
    listing_url: 'https://example.com', condition_delta: 'same', adjusted_price_cents: 10_000,
    color: null, relevance_score: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

test('computeAdjustedPricing: median of 3 sold comps, includePremiums false matches comps-only estimate', () => {
  const listing = { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const comps = [
    comp({ sale_price_cents: 10_000 }),
    comp({ sale_price_cents: 12_000 }),
    comp({ sale_price_cents: 14_000 }),
  ]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: false })
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.priceCents, 12_000)
  assert.equal(result.priceToMoveCents, 10_200) // jewelry: 12000 * (1 - 0.15)
  assert.equal(result.inclusionPremiumCents, 0)
  assert.equal(result.authenticityPremiumCents, 0)
})

test('computeAdjustedPricing: includePremiums true layers inclusion + authenticity premiums onto the base', () => {
  const listing = {
    condition: 'good', category: 'jewelry' as const, sub_type: null,
    inclusions: [
      inclusion('Original box'),
      inclusion('Authenticity card', { docSource: 'original' }),
    ],
  }
  const comps = [comp({ sale_price_cents: 12_000 })]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: true })
  // base 12000 (low tier), + box premium 400 (base table) + auth premium 500 (original, low, below $500 threshold)
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.inclusionPremiumCents, 400)
  assert.equal(result.authenticityPremiumCents, 500)
  assert.equal(result.priceCents, 12_900)
  assert.equal(result.priceToMoveCents, 10_965) // 12900 * 0.85, rounded
})

test('computeAdjustedPricing: active-market comps are excluded from the sold-price median', () => {
  const listing = { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const comps = [
    comp({ sale_price_cents: 12_000, source: 'ebay' }),
    comp({ sale_price_cents: 1, source: 'ebay_active' }), // would wreck the median if included
  ]
  const result = computeAdjustedPricing(listing, comps, { includePremiums: false })
  assert.equal(result.basePriceCents, 12_000)
  assert.equal(result.compCount, 1)
})

test('computeAdjustedPricing: recomputes against the listing\'s CURRENT condition, not any cached comp delta (staleness fix)', () => {
  const comps = [comp({ sale_price_cents: 10_000, condition: 'Like new', condition_delta: 'better', adjusted_price_cents: 99_999 })]

  const worse = computeAdjustedPricing(
    { condition: 'very_good', category: 'jewelry' as const, sub_type: null, inclusions: [] },
    comps, { includePremiums: false }
  )
  const better = computeAdjustedPricing(
    { condition: 'new_with_tags', category: 'jewelry' as const, sub_type: null, inclusions: [] },
    comps, { includePremiums: false }
  )

  // Same comp row (including its stale adjusted_price_cents: 99999), different current
  // condition on the listing — the stored adjusted_price_cents/condition_delta columns are
  // ignored entirely; only listing.condition and the comp's raw condition text are used.
  assert.equal(worse.priceCents, 8_500) // very_good (rank 5) < Like new (rank 6) → worse → 10000 * 0.85
  assert.equal(better.priceCents, 11_500) // new_with_tags (rank 8) > Like new (rank 6) → better → 10000 * 1.15
})

test('computeAdjustedPricing: no sold comps returns null price', () => {
  const listing = { condition: 'good', category: 'jewelry' as const, sub_type: null, inclusions: [] }
  const result = computeAdjustedPricing(listing, [], { includePremiums: false })
  assert.equal(result.basePriceCents, null)
  assert.equal(result.priceCents, null)
  assert.equal(result.priceToMoveCents, null)
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: FAIL — `computeAdjustedPricing is not a function`.

- [x] **Step 3: Implement `computeAdjustedPricing`**

Add to `src/lib/pipeline/pricing-adjust.ts` (after `authenticityPremiumCents`):

```ts
import type { Listing, PricingComp } from '@/types/listings'

export interface AdjustedPricing {
  priceCents: number | null
  priceToMoveCents: number | null
  basePriceCents: number | null
  inclusionPremiumCents: number
  authenticityPremiumCents: number
  compCount: number
}

type PricingListing = Pick<Listing, 'condition' | 'category' | 'sub_type' | 'inclusions'>

/**
 * The single source of truth for "what does this listing cost" — used for FieldsPanel display,
 * the eBay publish price, and the auto-discount cron's current-price fallback. Always
 * recomputed fresh from the listing's *current* condition/inclusions, never from data cached at
 * step3 gather-time, so it self-heals when condition-reassessment flips condition_confirmed
 * back to false post-intake — see condition-reassessment.ts. `includePremiums: false`
 * reproduces step3's original comps+condition-only estimate; `includePremiums: true` layers on
 * inclusion + authenticity premiums, both computed off the pre-premium base price so they can't
 * create a circular price-tier lookup.
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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 pricing-adjust`
Expected: PASS, all tests green (28 total).

- [x] **Step 5: Run the full test suite and lint to confirm nothing else broke**

Run: `npm test && npm run lint`
Expected: all green, no lint errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/pipeline/pricing-adjust.ts src/lib/pipeline/pricing-adjust.test.ts
git commit -m "feat(pricing-adjust): computeAdjustedPricing — single source of truth for listing price"
```

---

## Task 5: Refactor `step3-pricing-research.ts` to use the shared module

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts:1-5,413-445,684-698`

No behavior change — this removes the now-duplicated `conditionDelta`/`adjustForCondition`/`CATEGORY_DISCOUNT` definitions and imports them from `pricing-adjust.ts` instead, so step3's provisional (comps-only) estimate and the new gated final price share one implementation.

- [x] **Step 1: Add the import**

In `src/lib/pipeline/step3-pricing-research.ts`, after the existing imports (after line 5, `import { searchEbayActive } from './comps/ebay-browse'`), add:

```ts
import { conditionDelta, adjustForCondition, CATEGORY_DISCOUNT } from './pricing-adjust'
```

- [x] **Step 2: Remove the duplicated `conditionDelta` and `adjustForCondition` functions**

Delete lines 413-445 (the full `function conditionDelta(...)` and `function adjustForCondition(...)` definitions) — they're now imported.

- [x] **Step 3: Remove the duplicated `CATEGORY_DISCOUNT` constant**

Find this block (originally around line 684-694):

```ts
  const CATEGORY_DISCOUNT: Record<string, number> = {
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
  const discountPct = CATEGORY_DISCOUNT[step2.category?.toLowerCase() ?? ''] ?? 0.18
```

Replace with just:

```ts
  const discountPct = CATEGORY_DISCOUNT[step2.category?.toLowerCase() ?? ''] ?? 0.18
```

(the `CATEGORY_DISCOUNT` object literal is deleted; the lookup line stays, now using the imported constant.)

- [x] **Step 4: Verify the file still compiles and existing behavior is unchanged**

Run: `npm run build 2>&1 | tail -40`
Expected: build succeeds with no type errors in `step3-pricing-research.ts`.

Run: `npm test`
Expected: all tests still pass (step3 has no dedicated test file today, so this just confirms nothing else broke).

- [x] **Step 5: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "refactor(step3): import condition-delta/discount logic from pricing-adjust"
```

---

## Task 6: Gate the finalize route on condition + inclusions

**Files:**
- Modify: `src/app/api/listings/[id]/finalize/route.ts`

Replaces the INTERIM `condition_confirmed`-only check (lines 25-31) with the combined gate — this *is* the real pricing gate the ticket asked for, not a second layer on top of the interim one.

- [x] **Step 1: Update the select and the gate check**

In `src/app/api/listings/[id]/finalize/route.ts`, replace:

```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
```

with:

```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Inclusion } from '@/types/listings'
```

Then replace:

```ts
  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, condition_confirmed')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // INTERIM: blocks Finalize on condition_confirmed until ai-listings-yva's real
  // pricing-gate design lands. ai-listings-yva's acceptance criteria include
  // reconciling (keep/replace/remove) this exact check -- see that ticket
  // before removing or duplicating this gate.
  if (!listing.condition_confirmed) {
    return Response.json({ error: 'Condition must be approved before finalizing.' }, { status: 400 })
  }
```

with:

```ts
  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, condition_confirmed, inclusions')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Real pricing gate (ai-listings-yva): pricing (comp premiums + authenticity premium) only
  // reflects condition + inclusions once both are confirmed -- see computeAdjustedPricing in
  // pricing-adjust.ts. Finalizing before either is confirmed would lock in a price that hasn't
  // accounted for them.
  const inclusions = (listing.inclusions ?? []) as Inclusion[]
  if (!listing.condition_confirmed || inclusions.some((i) => !i.confirmed)) {
    return Response.json(
      { error: 'Confirm condition and all inclusions before finalizing.' },
      { status: 400 }
    )
  }
```

- [x] **Step 2: Manual verification (no existing route-test convention in this codebase — see `src/app/api/listings/` for confirmation no `*.test.ts` files exist there)**

Run: `npm run build`
Expected: builds clean.

Start the dev server (`npm run dev`) and, for a listing with `condition_confirmed: false` or an unconfirmed inclusion, `PATCH /api/listings/<id>/finalize` and confirm a 400 with the new combined error message. Confirm both fields together allow a 200.

- [x] **Step 3: Commit**

```bash
git add "src/app/api/listings/[id]/finalize/route.ts"
git commit -m "feat(finalize): gate on condition + inclusions confirmation, replacing the interim check"
```

---

## Task 7: Wire `computeAdjustedPricing` into FieldsPanel display

**Files:**
- Modify: `src/components/workspace/FieldsPanel.tsx:1-14,252-282,636-649`

- [x] **Step 1: Add the import**

In `src/components/workspace/FieldsPanel.tsx`, after the existing `import { getInclusionChecklist } from '@/lib/inclusions'` line (line 13), add:

```ts
import { computeAdjustedPricing } from '@/lib/pipeline/pricing-adjust'
```

- [x] **Step 2: Compute the gated pricing**

Inside `FieldsPanel`, immediately after the existing `checklistCandidates` computation (after line 171, before `async function saveAuthPlan`), add:

```ts
  const gateUnlocked = listing.condition_confirmed && inclusions.every((i) => i.confirmed)
  const pricing = computeAdjustedPricing(listing, comps, { includePremiums: gateUnlocked })
```

- [x] **Step 3: Replace the price display block**

Replace the existing block (lines 252-282):

```tsx
        {listing.suggested_price_cents != null && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-emerald-400">
                {formatPrice(listing.suggested_price_cents)}
              </span>
              {listing.confidence_score != null && (
                <span className="text-xs text-gray-500">{listing.confidence_score}% confidence</span>
              )}
            </div>
            {listing.price_to_move_cents != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-amber-400 font-medium">{formatPrice(listing.price_to_move_cents)}</span>
                <span className="text-xs text-gray-500">
                  to move{listing.price_to_move_discount_pct != null && <> · {Math.round(listing.price_to_move_discount_pct)}% off moves faster</>}
                </span>
              </div>
            )}
            {comps.length > 0 ? (
              <button
                onClick={() => setEvidenceOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                View {comps.length} comp{comps.length === 1 ? '' : 's'}
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-gray-700">No market comparables found</span>
            )}
          </div>
        )}
```

with:

```tsx
        {pricing.priceCents != null && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-emerald-400">
                {formatPrice(pricing.priceCents)}
              </span>
              {listing.confidence_score != null && (
                <span className="text-xs text-gray-500">{listing.confidence_score}% confidence</span>
              )}
            </div>
            {pricing.priceToMoveCents != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-amber-400 font-medium">{formatPrice(pricing.priceToMoveCents)}</span>
                <span className="text-xs text-gray-500">
                  to move{listing.price_to_move_discount_pct != null && <> · {Math.round(listing.price_to_move_discount_pct)}% off moves faster</>}
                </span>
              </div>
            )}
            {!gateUnlocked && (
              <p className="text-[10px] text-amber-500/80">
                Provisional — will be refined once condition and inclusions are confirmed.
              </p>
            )}
            {comps.length > 0 ? (
              <button
                onClick={() => setEvidenceOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                View {comps.length} comp{comps.length === 1 ? '' : 's'}
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-gray-700">No market comparables found</span>
            )}
          </div>
        )}
```

- [x] **Step 4: Keep the EvidenceDrawer in sync with the same computed numbers**

Replace (lines 636-649):

```tsx
      <EvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        comps={comps}
        suggestedPriceCents={listing.suggested_price_cents}
        confidenceScore={listing.confidence_score}
        priceToMoveCents={listing.price_to_move_cents}
        priceToMoveDiscountPct={listing.price_to_move_discount_pct}
        retailPriceCents={listing.retail_price_cents}
        retailPriceSource={listing.retail_price_source}
        retailPromoNote={listing.retail_promo_note}
        pricingMethodology={listing.pricing_methodology}
        priceHistory={priceHistory}
      />
```

with:

```tsx
      <EvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        comps={comps}
        suggestedPriceCents={pricing.priceCents}
        confidenceScore={listing.confidence_score}
        priceToMoveCents={pricing.priceToMoveCents}
        priceToMoveDiscountPct={listing.price_to_move_discount_pct}
        retailPriceCents={listing.retail_price_cents}
        retailPriceSource={listing.retail_price_source}
        retailPromoNote={listing.retail_promo_note}
        pricingMethodology={listing.pricing_methodology}
        priceHistory={priceHistory}
      />
```

- [x] **Step 5: Manual smoke test (no component-test convention exists in this codebase — confirmed zero `*.test.tsx` files)**

Run: `npm run lint && npm run build`
Expected: both clean.

Run `npm run dev`, open a listing that has comps but unconfirmed condition or an unconfirmed inclusion — confirm the price shows with the amber "Provisional — will be refined..." note. Confirm condition and every inclusion, refresh, and confirm the note disappears and the number may change (reflecting inclusion/authenticity premiums).

- [x] **Step 6: Commit**

```bash
git add src/components/workspace/FieldsPanel.tsx
git commit -m "feat(fields-panel): show gated adjusted price with provisional note"
```

---

## Task 8: Route the publish price through `computeAdjustedPricing` (resolves the dormant `final_price_cents` TODO)

**Files:**
- Modify: `src/lib/platforms/unified-listing.ts`
- Modify: `src/lib/platforms/unified-listing.test.ts`
- Modify: `src/app/api/listings/[id]/post-to-ebay/route.ts`

- [x] **Step 1: Write the failing tests**

In `src/lib/platforms/unified-listing.test.ts`, add a `fixtureComp` helper after `fixturePhoto` and update the price-related tests. Replace:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUnifiedListingForEbay } from './unified-listing'
import type { Listing, Photo } from '@/types/listings'
```

with:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUnifiedListingForEbay } from './unified-listing'
import type { Listing, Photo, PricingComp } from '@/types/listings'

function fixtureComp(overrides: Partial<PricingComp> = {}): PricingComp {
  return {
    id: 'comp-1', listing_id: 'listing-1', source: 'ebay', title: 'Comp',
    sale_price_cents: 12_000, condition: 'Not specified', sold_at: '2026-01-01T00:00:00Z',
    listing_url: 'https://example.com', condition_delta: 'same', adjusted_price_cents: 12_000,
    color: null, relevance_score: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
```

Six of the eight existing `buildUnifiedListingForEbay(...)` call sites don't assert on price and just need a third argument, `[]`, appended (no other changes) — in the tests named: `'buildUnifiedListingForEbay maps title/description/item_specifics from platform_fields.ebay'`, `'buildUnifiedListingForEbay uses the top-level internal condition enum, not platform_fields.ebay.condition_id'`, `'buildUnifiedListingForEbay uses internalId from sku'`, `'buildUnifiedListingForEbay filters to studio photos only, sorted by display_order, preferring processed_url'`, `'buildUnifiedListingForEbay throws when platform_fields.ebay is missing'`, and `'buildUnifiedListingForEbay throws when sku is not yet assigned'`. E.g. `buildUnifiedListingForEbay(fixtureListing(), [])` becomes `buildUnifiedListingForEbay(fixtureListing(), [], [])`; `buildUnifiedListingForEbay(fixtureListing(), photos)` becomes `buildUnifiedListingForEbay(fixtureListing(), photos, [])`.

The other two (`'buildUnifiedListingForEbay falls back to suggested_price_cents when final_price_cents is unset'` and `'buildUnifiedListingForEbay prefers final_price_cents over suggested_price_cents when both are set'`) get fully replaced below, along with two new tests. Replace:

```ts
test('buildUnifiedListingForEbay falls back to suggested_price_cents when final_price_cents is unset', async () => {
  const result = await buildUnifiedListingForEbay(fixtureListing(), [])
  assert.equal(result.price, 12000)
})

test('buildUnifiedListingForEbay prefers final_price_cents over suggested_price_cents when both are set', async () => {
  const result = await buildUnifiedListingForEbay(
    fixtureListing({ final_price_cents: 15000, suggested_price_cents: 12000 }),
    [],
  )
  assert.equal(result.price, 15000)
})
```

with:

```ts
test('buildUnifiedListingForEbay falls back to computeAdjustedPricing when final_price_cents is unset', async () => {
  // comp condition 'Like new' matches fixtureListing()'s condition 'like_new' exactly (same rank,
  // 6) -> conditionDelta is 'same' -> no condition adjustment, keeping this test's math about the
  // fallback wiring itself rather than condition-delta interaction (see the next test for that).
  const result = await buildUnifiedListingForEbay(fixtureListing(), [], [fixtureComp({ sale_price_cents: 12_000, condition: 'Like new' })])
  assert.equal(result.price, 12_000)
})

test('buildUnifiedListingForEbay prefers final_price_cents over the computed price when both are available', async () => {
  const result = await buildUnifiedListingForEbay(
    fixtureListing({ final_price_cents: 15000 }),
    [],
    [fixtureComp({ sale_price_cents: 12_000 })],
  )
  assert.equal(result.price, 15000)
})

test('buildUnifiedListingForEbay includes inclusion + authenticity premiums when condition and inclusions are confirmed', async () => {
  const result = await buildUnifiedListingForEbay(
    fixtureListing({
      category: 'jewelry',
      condition_confirmed: true,
      inclusions: [
        { item: 'Original box', source: 'detected', confirmed: true, notes: null },
        { item: 'Authenticity card', source: 'detected', confirmed: true, notes: null, docSource: 'original' },
      ],
    }),
    [],
    [fixtureComp({ sale_price_cents: 12_000, condition: 'Not specified' })],
  )
  // listing condition 'like_new' (rank 6) vs comp 'Not specified' (rank 4) -> better -> 12000*1.15 = 13800
  // + box premium 400 (base table, low tier) + auth premium 500 (original, low tier, below $500 threshold)
  assert.equal(result.price, 13_800 + 400 + 500)
})

test('buildUnifiedListingForEbay omits premiums when condition or inclusions are not confirmed', async () => {
  const result = await buildUnifiedListingForEbay(
    fixtureListing({
      category: 'jewelry',
      condition_confirmed: false,
      inclusions: [{ item: 'Original box', source: 'detected', confirmed: true, notes: null }],
    }),
    [],
    [fixtureComp({ sale_price_cents: 12_000, condition: 'Not specified' })],
  )
  assert.equal(result.price, 13_800) // condition premium applied (that's condition-adjustment, not the new gate) but no inclusion premium
})
```

Also fix every other existing test in the file to pass `[]` as the third argument (they don't assert on price so an empty comps array is fine — `computeAdjustedPricing` returns `priceCents: null` for no comps, and the code below falls back to `?? 0`).

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A5 unified-listing`
Expected: FAIL — TS error (`buildUnifiedListingForEbay` doesn't accept a 3rd argument yet) or wrong assertion values.

- [x] **Step 3: Update `buildUnifiedListingForEbay`**

In `src/lib/platforms/unified-listing.ts`, replace:

```ts
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
```

with:

```ts
import type { Listing, Photo, PricingComp } from '@/types/listings';
import type { UnifiedListing } from './types';
import { toPublicUrl } from '@/lib/pipeline/to-public-url';
import { computeAdjustedPricing } from '@/lib/pipeline/pricing-adjust';

/**
 * Builds the platform-agnostic {@link UnifiedListing} the eBay adapter's `createListing`
 * expects, from a real `Listing` row + its `photos` + its `pricing_comps` rows.
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
  comps: PricingComp[],
): Promise<UnifiedListing> {
```

Then replace:

```ts
  // Open question for Joe (not settled): nothing in the pipeline currently sets
  // final_price_cents before publish, so this falls back to suggested_price_cents (the AI
  // pricing-research estimate). Confirm whether posting to eBay should instead *require*
  // final_price_cents to be explicitly set first (e.g. after Joe reviews/adjusts the price)
  // rather than silently publishing at the AI-suggested price.
  const priceCents = listing.final_price_cents ?? listing.suggested_price_cents ?? 0;
```

with:

```ts
  // final_price_cents (an explicit seller override, e.g. from auto-discount) always wins when
  // set. Otherwise, computeAdjustedPricing is the source of truth -- includePremiums only when
  // condition + every inclusion are confirmed, matching the finalize-route gate exactly (a
  // listing can't reach 'finalizing'/publish without passing that gate, but this is computed
  // defensively rather than assumed).
  const gateUnlocked = listing.condition_confirmed && listing.inclusions.every((i) => i.confirmed);
  const adjusted = computeAdjustedPricing(listing, comps, { includePremiums: gateUnlocked });
  const priceCents = listing.final_price_cents ?? adjusted.priceCents ?? 0;
```

- [x] **Step 4: Update the caller to fetch and pass comps**

In `src/app/api/listings/[id]/post-to-ebay/route.ts`, replace:

```ts
  const { data: photoRows } = await supabase
    .from('photos')
    .select('*')
    .eq('listing_id', id)
    .order('display_order', { ascending: true })
  const photos = (photoRows ?? []) as unknown as Photo[]

  try {
    const unifiedListing = await buildUnifiedListingForEbay(listing, photos)
```

with:

```ts
  const [{ data: photoRows }, { data: compRows }] = await Promise.all([
    supabase
      .from('photos')
      .select('*')
      .eq('listing_id', id)
      .order('display_order', { ascending: true }),
    supabase
      .from('pricing_comps')
      .select('*')
      .eq('listing_id', id),
  ])
  const photos = (photoRows ?? []) as unknown as Photo[]
  const comps = (compRows ?? []) as unknown as PricingComp[]

  try {
    const unifiedListing = await buildUnifiedListingForEbay(listing, photos, comps)
```

And update the import line at the top of the file — replace:

```ts
import type { Listing, Photo, PlatformFields, ListingUrls } from '@/types/listings'
```

with:

```ts
import type { Listing, Photo, PlatformFields, ListingUrls, PricingComp } from '@/types/listings'
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A5 unified-listing`
Expected: PASS, all tests green.

Run: `npm run build`
Expected: builds clean (confirms `post-to-ebay/route.ts` compiles against the new 3-arg signature).

- [x] **Step 6: Commit**

```bash
git add src/lib/platforms/unified-listing.ts src/lib/platforms/unified-listing.test.ts "src/app/api/listings/[id]/post-to-ebay/route.ts"
git commit -m "fix(publish): route eBay publish price through computeAdjustedPricing

Resolves the dormant final_price_cents fallback -- publish previously
fell back to the raw, unadjusted suggested_price_cents, silently
ignoring condition changes made after step3 ran and never including
inclusion/authenticity premiums."
```

---

## Task 9: Route the auto-discount cron's current-price fallback through `computeAdjustedPricing`

**Files:**
- Modify: `src/lib/inngest/functions/auto-discount-cron.ts`

- [x] **Step 1: Expand the listings select and fetch comps per listing**

In `src/lib/inngest/functions/auto-discount-cron.ts`, replace:

```ts
      const { data: listings } = await supabase
        .from('listings')
        .select(
          'id, user_id, final_price_cents, suggested_price_cents, auto_discount_enabled, auto_discount_pct, auto_discount_interval_days'
        )
        .eq('status', 'published')
```

with:

```ts
      const { data: listings } = await supabase
        .from('listings')
        .select(
          'id, user_id, final_price_cents, suggested_price_cents, condition, condition_confirmed, category, sub_type, inclusions, auto_discount_enabled, auto_discount_pct, auto_discount_interval_days'
        )
        .eq('status', 'published')
```

- [x] **Step 2: Compute the adjusted current price instead of falling back to `suggested_price_cents`**

Add the import at the top of the file — replace:

```ts
import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
```

with:

```ts
import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { computeAdjustedPricing } from '@/lib/pipeline/pricing-adjust'
import type { Inclusion, Listing, PricingComp } from '@/types/listings'
```

Then replace:

```ts
          const initialPrice = (initialEvent?.price_cents as number | null) ?? (listing.suggested_price_cents as number | null) ?? 0
          if (initialPrice <= 0) continue
          const currentPrice = (listing.final_price_cents as number | null) ?? (listing.suggested_price_cents as number | null) ?? 0
          if (currentPrice <= 0) continue
```

with:

```ts
          const initialPrice = (initialEvent?.price_cents as number | null) ?? (listing.suggested_price_cents as number | null) ?? 0
          if (initialPrice <= 0) continue

          const { data: compRows } = await supabase
            .from('pricing_comps')
            .select('*')
            .eq('listing_id', listing.id)
          const comps = (compRows ?? []) as unknown as PricingComp[]
          const inclusions = (listing.inclusions as Inclusion[] | null) ?? []
          const gateUnlocked = (listing.condition_confirmed as boolean) && inclusions.every((i) => i.confirmed)
          const adjusted = computeAdjustedPricing(
            {
              condition: listing.condition as Listing['condition'],
              category: listing.category as Listing['category'],
              sub_type: listing.sub_type as Listing['sub_type'],
              inclusions,
            },
            comps,
            { includePremiums: gateUnlocked }
          )
          const currentPrice = (listing.final_price_cents as number | null) ?? adjusted.priceCents ?? (listing.suggested_price_cents as number | null) ?? 0
          if (currentPrice <= 0) continue
```

This is more verbose than the other call sites because Supabase's untyped row shape here requires per-field casts (matching this function's existing style — every other field on `listing` is already cast with `as X` inline, e.g. `listing.auto_discount_enabled as boolean | null`).

- [x] **Step 3: Verify**

Run: `npm run build`
Expected: builds clean.

Run: `npm test`
Expected: unaffected (no existing test file for this Inngest function — confirmed no `*.test.ts` under `src/lib/inngest/`).

- [x] **Step 4: Commit**

```bash
git add src/lib/inngest/functions/auto-discount-cron.ts
git commit -m "fix(auto-discount): use computeAdjustedPricing for the current-price fallback"
```

---

## Task 10: Final verification, follow-up ticket, and PR

**Files:** none (verification + housekeeping only)

- [x] **Step 1: Run the full quality gate**

Run: `npm run lint && npm test && npm run build`
Expected: all three clean.

- [x] **Step 2: File the descoped complete-set bonus as a follow-up**

```bash
bd create --title="Complete-set inclusion pricing bonus" --type=feature --priority=3 \
  --description="ai-listings-yva's design (2026-08-18) explicitly descoped the 'complete set' bonus (all expected inclusion items present together worth more than the sum of individual premiums) for v1 -- see docs/superpowers/specs/2026-08-18-pricing-gate-inclusions-authenticity-design.md. Design it and add it to computeAdjustedPricing/inclusionPremiumCents in src/lib/pipeline/pricing-adjust.ts once the base premium mechanism has real usage/conversion data to validate against."
```

- [x] **Step 3: Push the branch and open the PR**

```bash
git push -u origin feat/pricing-gate
gh pr create --title "feat: gate pricing behind condition+inclusions, add inclusion/authenticity premiums" --body "$(cat <<'EOF'
## Summary
- Gates the final, priced suggested price behind confirmed condition + confirmed inclusions (replaces the ai-listings-e75 INTERIM finalize check with the real combined gate)
- Adds category/price-tier inclusion dollar premiums and authenticity-threshold-aware pricing (eBay Authenticity Guarantee / Poshmark Posh Authenticate thresholds)
- Fixes a condition-reassessment staleness gap: pricing now always recomputes from the listing's current condition rather than data cached at step3 gather-time
- Resolves a dormant `final_price_cents` fallback found during design — eBay publish and the auto-discount cron now route through the same `computeAdjustedPricing` used for display, instead of silently publishing the unadjusted AI-suggested price

## Test plan
- [x] `npm test` — new `pricing-adjust.test.ts` (28 tests) covering condition delta, price tiers, inclusion premiums, authenticity thresholds, and the full computeAdjustedPricing integration including the staleness-fix case
- [x] `npm test` — updated `unified-listing.test.ts` covering the premium-aware publish price and the final_price_cents override precedence
- [x] `npm run lint` clean
- [x] `npm run build` clean
- [x] Manual: FieldsPanel shows the provisional-price amber note pre-confirmation and the final price post-confirmation (no automated component-test convention exists in this repo)
- [x] Manual: finalize route returns 400 with unconfirmed condition/inclusions, 200 once both confirmed

Design doc: `docs/superpowers/specs/2026-08-18-pricing-gate-inclusions-authenticity-design.md`
EOF
)"
```

- [x] **Step 4: Drive the PR to approval**

Per the `driving-a-pr-to-approval` runbook — this repo's reviewers are `sourcery-ai`, `chatgpt-codex-connector`, `greptile-apps` (advisory). Triage feedback, fix real issues, re-poll, merge once green/approved.

- [x] **Step 5: Session close**

```bash
bd close ai-listings-yva
bd dolt push
git pull --rebase
git push
git status  # must show up to date with origin
```

Then remove the worktree and prune:

```bash
cd /Users/joe/github/joeblackwaslike/ai-listings
git worktree remove .worktrees/pricing-gate
git fetch --prune
```
