# Shipping Measurements & Finalizing Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shipping-box estimation (item dims → padded box, with the shoe-pair-doubling adjustment) and resurrect the dead `finalizing` status as a real, non-blocking readiness checklist (shipping measurements + title-length), per Features 3 and 4 of `docs/superpowers/specs/2026-08-15-jewelry-shoe-measurement-gate-design.md`.

**Architecture:** Shipping-only data (box dims, weight) is fully decoupled from the identity gate — it's never shown at `gender_gate`, only surfaced later via an explicit "Finalize" action (`in_loop` → `finalizing`) and a new editable-measurements PATCH route. Item dimensions (shoes' new L×W×H, other categories' existing generic W/H/D) stay at the identity gate as today, since they double as the input to a computed `estimated_shipping_box` — padded item dims by default, with a shoe-pair-doubling adjustment, overridden by real box dims once measured. Both new capabilities are pure, unit-tested calculation modules (`src/lib/sizing/shipping-box.ts`, `src/lib/pipeline/finalizing-checklist.ts`) wired into existing UI/pipeline seams — no new database columns or migrations are needed since `measurements` is already a JSONB column and `finalizing` already exists in the `ListingStatus` type.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres/JSONB), Inngest, `node:test` + `node --import tsx --test`.

**Convention note (read before starting):** This repo has no automated test harness for API routes yet (`ai-listings-8du`, still open) — the inclusions/publish/archive/skip-bg routes all ship without direct tests today. Follow that same convention here: pure calculation/decision logic gets real TDD (`node:test`), new API routes and UI wiring get manual verification (dev server + browser), not invented test scaffolding. `npm test`'s own script is broken (`ai-listings-aqz` — its glob doesn't expand recursively under `sh`) — always run individual test files directly via `node --import tsx --test <path>`, and use `node --import tsx --test $(find src -name "*.test.ts")` for full-suite verification.

---

## File Structure

- **Modify** `src/types/listings.ts` — new `Measurements` keys for shoe item dims, computed/real box dims, and the already-existing-but-unused `weight_oz`.
- **Create** `src/lib/sizing/shipping-box.ts` + `.test.ts` — pure `computeEstimatedShippingBox()`, the padding constant.
- **Modify** `src/lib/utils.ts` + `src/lib/utils.test.ts` — shoe item-dimension fields, disambiguated generic W/H/D hints.
- **Modify** `src/lib/inngest/functions/intake-pipeline.ts` — wire box computation into the existing `store-gender` step.
- **Create** `src/lib/pipeline/title-check.ts` + `.test.ts` — extracted, multi-platform title-length check.
- **Modify** `src/app/api/listings/[id]/publish/route.ts` — reuse the extracted title-check function.
- **Create** `src/lib/pipeline/finalizing-checklist.ts` + `.test.ts` — pure `needsBoxMeasurement`/`needsWeight`/`hasIncludedBox`/`HEAVY_ITEM_CATEGORIES`.
- **Create** `src/app/api/listings/[id]/measurements/route.ts` — new editable-measurements PATCH route.
- **Create** `src/app/api/listings/[id]/finalize/route.ts` — new `in_loop` → `finalizing` PATCH route.
- **Create** `src/components/workspace/FinalizeButton.tsx` — mirrors `ArchiveButton.tsx`.
- **Modify** `src/app/listings/[id]/page.tsx` — render `FinalizeButton` in the header when `in_loop`.
- **Create** `src/components/workspace/FinalizingChecklist.tsx` — the non-blocking checklist UI.
- **Modify** `src/components/workspace/FieldsPanel.tsx` — render the checklist when `status === 'finalizing'`.

---

### Task 1: Extend the `Measurements` type for shipping fields

**Files:**
- Modify: `src/types/listings.ts:151-160` (the `Measurements` interface)

- [ ] **Step 1: Add the new fields**

Find this block (the tail of the `Measurements` interface):

```ts
  // sneakers: sizing system capture (us_size above stays the resolved value)
  shoe_size_system?: string;
  shoe_size_raw?: string;
  // general
  weight_oz?: number;
}
```

Replace it with:

```ts
  // sneakers: sizing system capture (us_size above stays the resolved value)
  shoe_size_system?: string;
  shoe_size_raw?: string;
  // sneakers: physical item dimensions -- one shoe of the pair, not the box. Only
  // sneakers get dedicated L/W/H fields; every other category without sub-type-specific
  // fields uses the generic width/height/depth above instead.
  item_length_in?: number;
  item_width_in?: number;
  item_height_in?: number;
  // shipping: computed estimate (padded item dims, or the real box below when known) --
  // never asked for directly. See computeEstimatedShippingBox in lib/sizing/shipping-box.ts.
  estimated_shipping_box?: { length: number; width: number; height: number };
  // shipping: real box dimensions, filled in via the finalizing-gate checklist when the
  // original box is included -- overrides estimated_shipping_box when all three are known.
  box_length_in?: number;
  box_width_in?: number;
  box_height_in?: number;
  // general
  weight_oz?: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (existing errors, if any, are pre-existing and unrelated).

- [ ] **Step 3: Commit**

```bash
git add src/types/listings.ts
git commit -m "feat(types): add shipping measurement fields to Measurements"
```

---

### Task 2: Shipping-box computation (pure function, TDD)

**Files:**
- Create: `src/lib/sizing/shipping-box.ts`
- Test: `src/lib/sizing/shipping-box.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sizing/shipping-box.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEstimatedShippingBox, SHIPPING_BOX_PADDING_IN } from './shipping-box'

test('computeEstimatedShippingBox: generic category pads each of width/height/depth by 2x the padding constant', () => {
  const box = computeEstimatedShippingBox('handbag', { width: 10, height: 8, depth: 4 })
  assert.deepEqual(box, {
    length: 4 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 10 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 8 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})

test('computeEstimatedShippingBox: generic category returns null when any of width/height/depth is missing', () => {
  assert.equal(computeEstimatedShippingBox('handbag', { width: 10, height: 8 }), null)
  assert.equal(computeEstimatedShippingBox('handbag', null), null)
})

test('computeEstimatedShippingBox: sneakers doubles item width for the pair before padding', () => {
  const box = computeEstimatedShippingBox('sneakers', {
    item_length_in: 12,
    item_width_in: 4,
    item_height_in: 5,
  })
  assert.deepEqual(box, {
    length: 12 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 4 * 2 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 5 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})

test('computeEstimatedShippingBox: sneakers returns null when any item dimension is missing', () => {
  assert.equal(computeEstimatedShippingBox('sneakers', { item_length_in: 12, item_width_in: 4 }), null)
})

test('computeEstimatedShippingBox: sneakers ignores generic width/height/depth even if present', () => {
  const box = computeEstimatedShippingBox('sneakers', {
    item_length_in: 12,
    item_width_in: 4,
    item_height_in: 5,
    width: 999,
    height: 999,
    depth: 999,
  })
  assert.deepEqual(box, {
    length: 12 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 4 * 2 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 5 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/shipping-box.test.ts`
Expected: FAIL — `Cannot find module './shipping-box'` (the module doesn't exist yet).

- [ ] **Step 3: Implement**

Create `src/lib/sizing/shipping-box.ts`:

```ts
import type { ListingCategory, Measurements } from '@/types/listings'

// Packing-material estimate (bubble wrap/paper + box-wall clearance), not a sourced carrier
// spec -- same constant across every category. Adjust once real packages get compared
// against it; see Feature 3 in docs/superpowers/specs/2026-08-15-jewelry-shoe-measurement-gate-design.md.
export const SHIPPING_BOX_PADDING_IN = 2

export interface ShippingBoxDims {
  length: number
  width: number
  height: number
}

// Computed from item dims collected at the identity gate, never asked for directly.
// Returns null when the required item dims aren't present yet (gate not yet confirmed, or
// a category with no dimension fields at all -- clothing, ring/bangle/necklace jewelry).
export function computeEstimatedShippingBox(
  category: ListingCategory | string | null,
  measurements: Measurements | null
): ShippingBoxDims | null {
  if (!measurements) return null

  if (category === 'sneakers') {
    const { item_length_in, item_width_in, item_height_in } = measurements
    if (item_length_in == null || item_width_in == null || item_height_in == null) return null
    // The box has to fit both shoes of the pair, not one -- length and height are shared,
    // width doubles (two shoes side by side).
    const pairWidth = item_width_in * 2
    return {
      length: item_length_in + 2 * SHIPPING_BOX_PADDING_IN,
      width: pairWidth + 2 * SHIPPING_BOX_PADDING_IN,
      height: item_height_in + 2 * SHIPPING_BOX_PADDING_IN,
    }
  }

  const { width, height, depth } = measurements
  if (width == null || height == null || depth == null) return null
  return {
    length: depth + 2 * SHIPPING_BOX_PADDING_IN,
    width: width + 2 * SHIPPING_BOX_PADDING_IN,
    height: height + 2 * SHIPPING_BOX_PADDING_IN,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/shipping-box.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sizing/shipping-box.ts src/lib/sizing/shipping-box.test.ts
git commit -m "feat(shipping): add estimated shipping-box computation"
```

---

### Task 3: Shoe item-dimension fields + disambiguated generic W/H/D hints (TDD)

**Files:**
- Modify: `src/lib/utils.ts` (the `genericDimensionFields` constant and the `category === 'sneakers'` branch of `getMeasurementFields`)
- Modify: `src/lib/utils.test.ts:43-46` (existing sneakers test) and append new tests

- [ ] **Step 1: Update the existing sneakers test and add disambiguation tests (failing)**

In `src/lib/utils.test.ts`, replace:

```ts
test('getMeasurementFields: sneakers ask for sizing system, raw size, and optional US size', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  assert.deepEqual(fields.map((f) => f.key), ['shoe_size_system', 'shoe_size_raw', 'us_size'])
})
```

with:

```ts
test('getMeasurementFields: sneakers ask for sizing system, raw size, optional US size, and one-shoe item dimensions', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  assert.deepEqual(fields.map((f) => f.key), [
    'shoe_size_system',
    'shoe_size_raw',
    'us_size',
    'item_length_in',
    'item_width_in',
    'item_height_in',
  ])
})

test('getMeasurementFields: sneaker item-dimension hints say explicitly this is one shoe of the pair', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  const dims = fields.filter((f) => f.key.startsWith('item_'))
  assert.equal(dims.length, 3)
  for (const field of dims) {
    assert.match(field.hint, /one shoe of the pair/)
  }
})

test('getMeasurementFields: generic W/H/D fallback hints disambiguate which physical dimension is which', () => {
  const fields = getMeasurementFields('handbag', null, [])
  const width = fields.find((f) => f.key === 'width')
  const height = fields.find((f) => f.key === 'height')
  const depth = fields.find((f) => f.key === 'depth')
  assert.match(width!.hint, /side to side/)
  assert.match(height!.hint, /base to top/)
  assert.match(depth!.hint, /front to back/)
})
```

(Leave the other existing sneakers test, `'getMeasurementFields: sneakers asks for a sizing system and a size value'`, unchanged — it only checks a subset of keys and doesn't need updating.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/utils.test.ts`
Expected: FAIL — the sneakers key-array test fails (array length mismatch: 3 actual vs 6 expected), and the two new hint tests fail (`width!.hint` is `'in inches'`, not matching `/side to side/`, etc.)

- [ ] **Step 3: Implement**

In `src/lib/utils.ts`, replace:

```ts
const genericDimensionFields: import('@/types/listings').MeasurementField[] = [
  { key: 'width', label: 'Width', hint: 'in inches' },
  { key: 'height', label: 'Height', hint: 'in inches' },
  { key: 'depth', label: 'Depth', hint: 'in inches' },
]
```

with:

```ts
const genericDimensionFields: import('@/types/listings').MeasurementField[] = [
  { key: 'width', label: 'Width', hint: 'in inches — side to side at the widest point' },
  { key: 'height', label: 'Height', hint: 'in inches — base to top' },
  { key: 'depth', label: 'Depth', hint: 'in inches — front to back' },
]
```

And replace:

```ts
  if (category === 'sneakers') {
    return [
      { key: 'shoe_size_system', label: 'Sizing System', hint: 'which system is printed on the tag', useChips: true, chipOptions: ['US', 'EU', 'UK'] },
      { key: 'shoe_size_raw', label: 'Size (as printed)', hint: 'e.g. 39, 6.5, 8.5' },
      { key: 'us_size', label: 'US Size (if directly on the tag)', hint: 'skip if only EU/UK is shown — this gets computed otherwise' },
    ]
  }
```

with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/utils.test.ts`
Expected: PASS (all tests, including the 3 new/updated ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(measurements): add shoe item-dimension fields, disambiguate generic W/H/D hints"
```

---

### Task 4: Wire shipping-box computation into the intake pipeline

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts:1-13` (imports) and `:147-149` (the `store-gender` step)

No automated test for this step — it's inline in a large Inngest step function with no pipeline-level test harness in this repo (the same is true of the `sub_type` computation two lines above it, which has no direct test either; only the underlying pure functions it calls are tested, which Task 2 and Task 3 already cover).

- [ ] **Step 1: Add imports**

At the top of `src/lib/inngest/functions/intake-pipeline.ts`, replace:

```ts
import { detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { classifyJewelrySubTypeWithLlm } from '@/lib/jewelry-llm-fallback'
import type { ClothingSubType, JewelrySubType } from '@/types/listings'
```

with:

```ts
import { detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { classifyJewelrySubTypeWithLlm } from '@/lib/jewelry-llm-fallback'
import { computeEstimatedShippingBox } from '@/lib/sizing/shipping-box'
import type { ClothingSubType, JewelrySubType, Measurements } from '@/types/listings'
```

- [ ] **Step 2: Compute and merge the shipping-box estimate before writing measurements**

Replace:

```ts
      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements, sub_type: subType }).eq('id', listingId)
      )
```

with:

```ts
      const estimatedShippingBox = computeEstimatedShippingBox(category, measurements as Measurements | null)
      const measurementsWithShippingBox = estimatedShippingBox
        ? { ...measurements, estimated_shipping_box: estimatedShippingBox }
        : measurements

      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements: measurementsWithShippingBox, sub_type: subType }).eq('id', listingId)
      )
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/inngest/functions/intake-pipeline.ts
git commit -m "feat(pipeline): compute estimated shipping box when storing gate measurements"
```

---

### Task 5: Extract multi-platform title-length check (TDD), reuse in publish route

**Files:**
- Create: `src/lib/pipeline/title-check.ts`
- Test: `src/lib/pipeline/title-check.test.ts`
- Modify: `src/app/api/listings/[id]/publish/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pipeline/title-check.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTitleLengths, TITLE_LIMITS } from './title-check'

test('checkTitleLengths: flags an eBay title over 80 characters', () => {
  const longTitle = 'x'.repeat(TITLE_LIMITS.ebay + 1)
  const warnings = checkTitleLengths({ ebay: { title: longTitle } })
  assert.deepEqual(warnings, [{ platform: 'ebay', currentLength: longTitle.length, maxLength: TITLE_LIMITS.ebay }])
})

test('checkTitleLengths: flags a Poshmark title over 60 characters', () => {
  const longTitle = 'x'.repeat(TITLE_LIMITS.poshmark + 1)
  const warnings = checkTitleLengths({ poshmark: { title: longTitle } })
  assert.deepEqual(warnings, [{ platform: 'poshmark', currentLength: longTitle.length, maxLength: TITLE_LIMITS.poshmark }])
})

test('checkTitleLengths: returns a warning per platform when both are over limit', () => {
  const warnings = checkTitleLengths({
    ebay: { title: 'x'.repeat(TITLE_LIMITS.ebay + 1) },
    poshmark: { title: 'x'.repeat(TITLE_LIMITS.poshmark + 1) },
  })
  assert.deepEqual(warnings.map((w) => w.platform).sort(), ['ebay', 'poshmark'])
})

test('checkTitleLengths: returns no warnings when titles are within limits or missing', () => {
  assert.deepEqual(checkTitleLengths({ ebay: { title: 'short title' } }), [])
  assert.deepEqual(checkTitleLengths({}), [])
  assert.deepEqual(checkTitleLengths(null), [])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/pipeline/title-check.test.ts`
Expected: FAIL — `Cannot find module './title-check'`.

- [ ] **Step 3: Implement**

Create `src/lib/pipeline/title-check.ts`:

```ts
export const TITLE_LIMITS: Record<'ebay' | 'poshmark', number> = { ebay: 80, poshmark: 60 }

export interface TitleLengthWarning {
  platform: 'ebay' | 'poshmark'
  currentLength: number
  maxLength: number
}

// Warn but never block -- matches this codebase's existing convention (previously inlined
// in publish/route.ts, extracted here so the finalizing-gate checklist can reuse it without
// duplicating the limit table). Checks every platform with a stored title, not just one.
export function checkTitleLengths(
  platformFields: Partial<Record<'ebay' | 'poshmark', { title?: string }>> | null
): TitleLengthWarning[] {
  if (!platformFields) return []
  const warnings: TitleLengthWarning[] = []
  for (const platform of ['ebay', 'poshmark'] as const) {
    const title = platformFields[platform]?.title
    const maxLength = TITLE_LIMITS[platform]
    if (title && title.length > maxLength) {
      warnings.push({ platform, currentLength: title.length, maxLength })
    }
  }
  return warnings
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/pipeline/title-check.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor publish/route.ts to reuse it**

In `src/app/api/listings/[id]/publish/route.ts`, add this import near the top (alongside the existing `import type { Listing } from '@/types/listings'`):

```ts
import { checkTitleLengths } from '@/lib/pipeline/title-check'
```

Replace:

```ts
  // Title length validation — warn but do not block
  let titleWarning: { warning: string; currentLength: number; maxLength: number } | null = null
  if (platform && current.user_id) {
    const TITLE_LIMITS: Record<string, number> = { ebay: 80, poshmark: 60 }
    const maxLength = TITLE_LIMITS[platform]
    if (maxLength) {
      const platformFields = current.platform_fields as Record<string, Record<string, string>> | null
      const title: string | undefined = platformFields?.[platform]?.title
      if (title && title.length > maxLength) {
        titleWarning = { warning: 'title_too_long', currentLength: title.length, maxLength }
      }
    }
  }
```

with:

```ts
  // Title length validation — warn but do not block
  let titleWarning: { warning: string; currentLength: number; maxLength: number } | null = null
  if (platform && current.user_id && (platform === 'ebay' || platform === 'poshmark')) {
    const platformFields = current.platform_fields as Partial<Record<'ebay' | 'poshmark', { title?: string }>> | null
    const match = checkTitleLengths(platformFields).find((w) => w.platform === platform)
    if (match) {
      titleWarning = { warning: 'title_too_long', currentLength: match.currentLength, maxLength: match.maxLength }
    }
  }
```

This preserves the route's exact existing JSON response shape (`{ warning: 'title_too_long', currentLength, maxLength }` for the single requested platform) — a pure refactor, not a behavior change.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pipeline/title-check.ts src/lib/pipeline/title-check.test.ts src/app/api/listings/[id]/publish/route.ts
git commit -m "refactor(pipeline): extract multi-platform title-length check"
```

---

### Task 6: Finalizing-checklist decision logic (pure functions, TDD)

**Files:**
- Create: `src/lib/pipeline/finalizing-checklist.ts`
- Test: `src/lib/pipeline/finalizing-checklist.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pipeline/finalizing-checklist.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasIncludedBox, needsBoxMeasurement, needsWeight, HEAVY_ITEM_CATEGORIES } from './finalizing-checklist'

test('hasIncludedBox: matches an included inclusion mentioning "box" case-insensitively', () => {
  assert.equal(hasIncludedBox([{ item: 'Original Box', included: true, notes: null }]), true)
  assert.equal(hasIncludedBox([{ item: 'dust bag', included: true, notes: null }]), false)
  assert.equal(hasIncludedBox([{ item: 'Original Box', included: false, notes: null }]), false)
  assert.equal(hasIncludedBox([]), false)
})

test('needsBoxMeasurement: true when box is included and no box measurement stored yet', () => {
  const listing = { inclusions: [{ item: 'Original Box', included: true, notes: null }], measurements: null }
  assert.equal(needsBoxMeasurement(listing), true)
})

test('needsBoxMeasurement: false when no box is included', () => {
  const listing = { inclusions: [], measurements: null }
  assert.equal(needsBoxMeasurement(listing), false)
})

test('needsBoxMeasurement: false once all three box dimensions are stored', () => {
  const listing = {
    inclusions: [{ item: 'Original Box', included: true, notes: null }],
    measurements: { box_length_in: 10, box_width_in: 8, box_height_in: 4 },
  }
  assert.equal(needsBoxMeasurement(listing), false)
})

test('needsWeight: true for heavy-item categories with no weight stored', () => {
  assert.equal(needsWeight({ category: 'handbag', measurements: null }), true)
  for (const category of HEAVY_ITEM_CATEGORIES) {
    assert.equal(needsWeight({ category, measurements: null }), true)
  }
})

test('needsWeight: false for jewelry and sneakers regardless of weight', () => {
  assert.equal(needsWeight({ category: 'jewelry', measurements: null }), false)
  assert.equal(needsWeight({ category: 'sneakers', measurements: null }), false)
})

test('needsWeight: false once weight_oz is stored', () => {
  assert.equal(needsWeight({ category: 'handbag', measurements: { weight_oz: 12 } }), false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/pipeline/finalizing-checklist.test.ts`
Expected: FAIL — `Cannot find module './finalizing-checklist'`.

- [ ] **Step 3: Implement**

Create `src/lib/pipeline/finalizing-checklist.ts`:

```ts
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
  return inclusions.some((i) => i.included && /box/i.test(i.item))
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/pipeline/finalizing-checklist.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/finalizing-checklist.ts src/lib/pipeline/finalizing-checklist.test.ts
git commit -m "feat(pipeline): add finalizing-checklist decision logic"
```

---

### Task 7: Editable-measurements PATCH route

**Files:**
- Create: `src/app/api/listings/[id]/measurements/route.ts`

No automated test — this repo has no API-route test harness (`ai-listings-8du`, open). Verified manually via the browser in Task 10, once the UI that calls it exists.

- [ ] **Step 1: Implement**

Create `src/app/api/listings/[id]/measurements/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Measurements } from '@/types/listings'

const EDITABLE_KEYS = ['box_length_in', 'box_width_in', 'box_height_in', 'weight_oz'] as const
type EditableKey = (typeof EDITABLE_KEYS)[number]

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const patch: Partial<Record<EditableKey, number>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEditableKey(key)) {
      return Response.json({ error: `Unknown measurement key: ${key}` }, { status: 400 })
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return Response.json({ error: `${key} must be a finite number` }, { status: 400 })
    }
    patch[key] = value
  }

  const supabase = getSupabaseAdmin()

  // Verify the listing belongs to the caller before updating with the admin client (RLS is
  // bypassed here) -- same pattern as skip-bg/route.ts.
  const { data: current } = await supabase
    .from('listings')
    .select('measurements, user_id')
    .eq('id', id)
    .single()

  if (!current || current.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const merged: Measurements = { ...(current.measurements as Measurements | null ?? {}), ...patch }

  // Known-value-first: a real measured box overrides the padded estimate once all three
  // dimensions are known -- see Feature 3's "Estimated shipping box" in the spec.
  if (merged.box_length_in != null && merged.box_width_in != null && merged.box_height_in != null) {
    merged.estimated_shipping_box = {
      length: merged.box_length_in,
      width: merged.box_width_in,
      height: merged.box_height_in,
    }
  }

  const { error } = await supabase
    .from('listings')
    .update({ measurements: merged })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, measurements: merged })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listings/[id]/measurements/route.ts
git commit -m "feat(api): add editable-measurements PATCH route"
```

---

### Task 8: Finalize PATCH route

**Files:**
- Create: `src/app/api/listings/[id]/finalize/route.ts`

No automated test — same convention as Task 7. Verified manually via the browser in Task 9.

- [ ] **Step 1: Implement**

Create `src/app/api/listings/[id]/finalize/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listings/[id]/finalize/route.ts
git commit -m "feat(api): add finalize PATCH route (in_loop -> finalizing)"
```

---

### Task 9: Finalize button, wired into the workspace header

**Files:**
- Create: `src/components/workspace/FinalizeButton.tsx`
- Modify: `src/app/listings/[id]/page.tsx`

- [ ] **Step 1: Create the button**

Create `src/components/workspace/FinalizeButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function FinalizeButton({ listingId }: Readonly<{ listingId: string }>) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleFinalize() {
    setLoading(true)
    try {
      const res = await fetch(`/api/listings/${listingId}/finalize`, { method: 'PATCH' })
      if (res.ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleFinalize}
      disabled={loading}
      title="Finalize listing"
      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-400 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Finalize
    </button>
  )
}
```

- [ ] **Step 2: Wire it into the workspace header**

In `src/app/listings/[id]/page.tsx`, add this import near the top, alongside the other workspace component imports (e.g. next to wherever `ArchiveButton` is imported from `@/components/workspace/ArchiveButton`):

```ts
import { FinalizeButton } from '@/components/workspace/FinalizeButton'
```

Replace:

```tsx
        <div className="ml-auto flex items-center gap-4">
          <ArchiveButton listingId={id} />
          <a href={`/listings/${id}/publish`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            Export →
          </a>
        </div>
```

with:

```tsx
        <div className="ml-auto flex items-center gap-4">
          {listing.status === 'in_loop' && <FinalizeButton listingId={id} />}
          <ArchiveButton listingId={id} />
          <a href={`/listings/${id}/publish`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            Export →
          </a>
        </div>
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`
Open a listing with `status = 'in_loop'` (or update one via SQL for testing: `kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c "UPDATE listings SET status = 'in_loop' WHERE id = '<id>'"` against a dev/test listing — **never run this against a real listing without confirming with Joe first**). Click "Finalize". Confirm:
- The button shows a spinner while loading.
- The page refreshes and the header no longer shows the Finalize button (status is now `finalizing`).
- The `StatusBadge` now shows "Ready to publish" (this label already existed in `StatusBadge.tsx` — no change needed there).

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/FinalizeButton.tsx "src/app/listings/[id]/page.tsx"
git commit -m "feat(workspace): add Finalize button to listing header"
```

---

### Task 10: Finalizing checklist UI

**Files:**
- Create: `src/components/workspace/FinalizingChecklist.tsx`
- Modify: `src/components/workspace/FieldsPanel.tsx`

- [ ] **Step 1: Create the checklist component**

Create `src/components/workspace/FinalizingChecklist.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Listing } from '@/types/listings'
import { checkTitleLengths } from '@/lib/pipeline/title-check'
import { needsBoxMeasurement, needsWeight } from '@/lib/pipeline/finalizing-checklist'

interface FinalizingChecklistProps {
  listing: Pick<Listing, 'id' | 'category' | 'inclusions' | 'measurements' | 'platform_fields'>
}

async function saveMeasurements(listingId: string, patch: Record<string, number>) {
  await fetch(`/api/listings/${listingId}/measurements`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function FinalizingChecklist({ listing }: Readonly<FinalizingChecklistProps>) {
  const [boxLength, setBoxLength] = useState('')
  const [boxWidth, setBoxWidth] = useState('')
  const [boxHeight, setBoxHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [savedBox, setSavedBox] = useState(false)
  const [savedWeight, setSavedWeight] = useState(false)

  const showBox = needsBoxMeasurement(listing) && !savedBox
  const showWeight = needsWeight(listing) && !savedWeight
  const titleWarnings = checkTitleLengths(listing.platform_fields)

  async function submitBox() {
    const length = parseFloat(boxLength)
    const width = parseFloat(boxWidth)
    const height = parseFloat(boxHeight)
    if (isNaN(length) || isNaN(width) || isNaN(height)) return
    await saveMeasurements(listing.id, { box_length_in: length, box_width_in: width, box_height_in: height })
    setSavedBox(true)
  }

  async function submitWeight() {
    const oz = parseFloat(weight)
    if (isNaN(oz)) return
    await saveMeasurements(listing.id, { weight_oz: oz })
    setSavedWeight(true)
  }

  if (!showBox && !showWeight && titleWarnings.length === 0) {
    return (
      <section>
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Finalizing Checklist
        </h3>
        <p className="text-xs text-emerald-400">Nothing outstanding.</p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Finalizing Checklist
      </h3>
      <div className="space-y-3">
        {titleWarnings.map((w) => (
          <p key={w.platform} className="text-xs text-amber-400">
            {w.platform} title is {w.currentLength} characters, over the {w.maxLength}-character limit.
          </p>
        ))}

        {showBox && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">Shipping box dimensions (original box included, in inches)</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder="L"
                value={boxLength}
                onChange={(e) => setBoxLength(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <input
                type="number"
                placeholder="W"
                value={boxWidth}
                onChange={(e) => setBoxWidth(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <input
                type="number"
                placeholder="H"
                value={boxHeight}
                onChange={(e) => setBoxHeight(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <button
                onClick={() => void submitBox()}
                disabled={!boxLength || !boxWidth || !boxHeight}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {showWeight && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">Weight (oz)</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder="oz"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-20 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <button
                onClick={() => void submitWeight()}
                disabled={!weight}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Wire it into FieldsPanel**

In `src/components/workspace/FieldsPanel.tsx`, add this import near the top (alongside `import { StatusBadge } from '@/components/dashboard/StatusBadge'`):

```ts
import { FinalizingChecklist } from '@/components/workspace/FinalizingChecklist'
```

Find the `Measurements` section:

```tsx
        {populatedMeasurements.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Measurements
            </h3>
            <dl className="space-y-2">
              {populatedMeasurements.map((field) => (
                <div key={field.key} className="flex justify-between text-xs">
                  <dt className="text-gray-600">{field.label}</dt>
                  <dd className="text-gray-300">
                    {formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
```

Add the checklist immediately after it (before the `Description` section):

```tsx
        {populatedMeasurements.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Measurements
            </h3>
            <dl className="space-y-2">
              {populatedMeasurements.map((field) => (
                <div key={field.key} className="flex justify-between text-xs">
                  <dt className="text-gray-600">{field.label}</dt>
                  <dd className="text-gray-300">
                    {formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {listing.status === 'finalizing' && <FinalizingChecklist listing={listing} />}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`
On a listing already moved to `finalizing` (via Task 9's Finalize button), confirm:
- If the listing has an included "box" inclusion and no box measurement, the checklist shows L/W/H inputs; entering values and clicking Save persists them (reload the page — the inputs disappear, since `needsBoxMeasurement` is now false).
- If the listing's category is one of `HEAVY_ITEM_CATEGORIES` (handbag, watches, collectibles, electronics, keyboards) and no weight is stored, the checklist shows a weight input; same save/reload check.
- If either eBay or Poshmark title exceeds its limit, the warning line renders.
- If none of the above apply, "Nothing outstanding." renders.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/FinalizingChecklist.tsx src/components/workspace/FieldsPanel.tsx
git commit -m "feat(workspace): add finalizing checklist UI"
```

---

### Task 11: Full verification, publish-reachability check, and bd housekeeping

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `node --import tsx --test $(find src -name "*.test.ts")`
Expected: all tests pass, including every test added in Tasks 2, 3, 5, and 6 (this repo's `npm test` script itself is broken — `ai-listings-aqz` — always use this `find`-based invocation).

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm publish is reachable from `finalizing` (no code change expected)**

Read `src/app/api/listings/[id]/publish/route.ts` and confirm the `PATCH` handler never checks `current.status` before allowing `listing_urls`/`mark_published` updates — it already works from any status, including `finalizing`. This is Feature 4's explicit "Publish is reachable from either `in_loop` or `finalizing`" requirement, already satisfied with zero code changes since the route was never status-gated to begin with. No action needed — this step is a documented confirmation, not a fix.

- [ ] **Step 4: Update ai-listings-6wb**

This spec fully absorbs `ai-listings-6wb` (weight capture with defer support), delivered by Tasks 6, 7, and 10 above. Close it:

```bash
bd close ai-listings-6wb --reason="Absorbed into and delivered by the shipping-measurements-finalizing-gate plan (docs/superpowers/plans/2026-08-15-shipping-measurements-finalizing-gate.md, Tasks 6/7/10) — weight_oz capture gated on HEAVY_ITEM_CATEGORIES, deferred to the finalizing checklist rather than blocking intake."
```

- [ ] **Step 5: Final commit and push**

```bash
git status
git add -A
git commit -m "chore: finalize shipping-measurements-finalizing-gate plan work" --allow-empty
bd dolt push
git push -u origin feat/shipping-measurements-finalizing-gate
```
