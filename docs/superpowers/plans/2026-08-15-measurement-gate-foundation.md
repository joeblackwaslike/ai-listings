# Measurement Gate Foundation — Plan A (sub_type rename/bugfix, jewelry fields, shoe sizing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give jewelry (ring/bangle/necklace) and shoes real, sub-type-appropriate measurement-gate fields instead of the generic W/H/D fallback, fix a pre-existing bug where `clothing_sub_type` is read in four places but written nowhere, and rename it to a shared `sub_type` column both categories use.

**Architecture:** Regex-first classification against `notable_features` (mirroring the existing `detectClothingSubType` pattern), with a sync path used for gate rendering and an async LLM-fallback used only as a non-blocking enrichment step after gate confirmation, when regex finds nothing. All conversion tables (ring diameter↔US size math, Hermès bangle ladder, shoe EU/UK↔US + brand overrides) are either a sourced formula or explicitly sourced reference data — never LLM-generated.

**Tech Stack:** Next.js (App Router), Supabase/Postgres, Inngest, `node:test` (matches existing `gate-messages.test.ts`), Claude via `runStructured` (`src/lib/claude/index.ts`).

**Spec:** `docs/superpowers/specs/2026-08-15-jewelry-shoe-measurement-gate-design.md` — this plan covers Features 1 and 2, and the `sub_type` half of "Data Model". Features 3 and 4 (shipping measurements, finalizing gate) and the step4a sizing-table plumbing are separate plans, sequenced after this one ships.

---

## File Structure

**New files:**
- `supabase/migrations/0016_sub_type_rename.sql` — renames `clothing_sub_type` → `sub_type`
- `src/lib/sizing/ring-size.ts` — mm↔US ring size conversion
- `src/lib/sizing/bangle-ladders.ts` — `BANGLE_SIZE_LADDERS` reference data
- `src/lib/sizing/shoe-conversion.ts` — `SHOE_SIZE_CONVERSION`, `SHOE_BRAND_OVERRIDES` reference data + conversion helper
- `src/lib/sizing/ring-size.test.ts`, `src/lib/sizing/bangle-ladders.test.ts`, `src/lib/sizing/shoe-conversion.test.ts`
- `src/lib/jewelry-detection.ts` — `detectJewelrySubType`, `detectIrregularRingStyle`, `parseChainLengthInches` (regex, sync)
- `src/lib/jewelry-detection.test.ts`
- `src/lib/utils.test.ts` — first test file for `getMeasurementFields` (none exists today)

**Modified files:**
- `src/types/listings.ts` — `JewelrySubType`, `Measurements` new keys, `Listing.sub_type` (renamed from `clothing_sub_type`), `DetailGateContext.subTypeHint` (renamed from `clothingSubTypeHint`)
- `src/lib/utils.ts` — `getMeasurementFields` extended: new `sub_type`/`notableFeatures` params, jewelry branch, sneakers system-picker branch
- `src/components/workspace/MeasurementFields.tsx` — new `defaultValues` prop for necklace chain-length pre-fill
- `src/lib/pipeline/gate-messages.ts` — jewelry sub-type detection wired into `buildGenderGatePrompt`, renamed field
- `src/lib/inngest/functions/intake-pipeline.ts` — `store-gender` step computes and writes `sub_type` (sync regex, then async LLM-fallback enrichment step for jewelry only)
- `src/lib/pipeline/step4a-draft-listing.ts`, `src/components/workspace/FieldsPanel.tsx`, `src/lib/agent/tools.ts` — `clothing_sub_type` → `sub_type` in `.select()` calls and `getMeasurementFields` calls

---

## Task 1: Rename `clothing_sub_type` → `sub_type` (migration + types) ✅ done (c4f96f0)

**Files:**
- Create: `supabase/migrations/0016_sub_type_rename.sql`
- Modify: `src/types/listings.ts:169` (`Listing.clothing_sub_type` field), `src/types/listings.ts:148` (`DetailGateContext.clothingSubTypeHint`)

- [ ] **Step 1: Write the migration**

```sql
-- Rename clothing_sub_type to sub_type: this column is about to be populated
-- for jewelry too (ring/bangle/necklace), not just clothing. Also backfills
-- existing rows, since clothing_sub_type has been read in four places
-- (step4a, FieldsPanel, agent/tools.ts, gate-messages.ts) but written
-- nowhere in the app -- confirmed via live query, 1 of 108 listings has a
-- non-null value. detectClothingSubType only needs notable_features, which
-- every listing already has, so a full backfill is safe and cheap.
ALTER TABLE listings RENAME COLUMN clothing_sub_type TO sub_type;
```

- [ ] **Step 2: Apply the migration**

Run: `kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0016_sub_type_rename.sql`
Expected: `ALTER TABLE`

- [ ] **Step 3: Rename the type fields**

In `src/types/listings.ts`, change:
```ts
  clothing_sub_type: ClothingSubType | null;
```
to:
```ts
  sub_type: ClothingSubType | JewelrySubType | null;
```
(the `JewelrySubType` type doesn't exist yet — Task 2 adds it; this will not compile until then, which is fine, Task 2 is next)

And change:
```ts
  clothingSubTypeHint: ClothingSubType | null;
```
to:
```ts
  subTypeHint: ClothingSubType | JewelrySubType | null;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0016_sub_type_rename.sql src/types/listings.ts
git commit -m "feat(db): rename clothing_sub_type to sub_type"
```

---

## Task 2: `JewelrySubType` type + new `Measurements` keys ✅ done (4c91666)

**Files:**
- Modify: `src/types/listings.ts`

- [ ] **Step 1: Add `JewelrySubType`**

Add near `ClothingSubType` (after line 115):
```ts
export type JewelrySubType =
  | 'ring'
  | 'bangle'
  | 'bracelet'
  | 'necklace'
  | 'earrings'
  | 'pendant'
  | 'brooch'
  | 'other';
```

- [ ] **Step 2: Add new `Measurements` keys**

In the `Measurements` interface, add after the `us_size?: number;` line:
```ts
  // jewelry: ring
  ring_inscribed_size?: string;
  ring_id_mm?: number;
  ring_id_widest_mm?: number;
  ring_id_narrowest_mm?: number;
  // jewelry: bangle
  bangle_id_mm?: number;
  // jewelry: necklace
  necklace_chain_length_in?: number;
  // sneakers: sizing system capture (us_size above stays the resolved value)
  shoe_size_system?: string;
  shoe_size_raw?: string;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/types/listings.ts` (errors from other files still referencing `clothing_sub_type` are expected and fixed in later tasks — confirm the *only* errors are exactly those, in `utils.ts`, `gate-messages.ts`, `step4a-draft-listing.ts`, `FieldsPanel.tsx`, `agent/tools.ts`)

- [ ] **Step 4: Commit**

```bash
git add src/types/listings.ts
git commit -m "feat(types): add JewelrySubType and new jewelry/shoe measurement keys"
```

---

## Task 3: `detectJewelrySubType` ✅ done (9e653f9) — known limitation: "Ring-Style Huggie Earrings"-type Model lines misclassify as ring due to regex ordering (ring checked before earrings); rare, undesigned-ahead-of-need per spec philosophy

**Files:**
- Create: `src/lib/jewelry-detection.ts`
- Create: `src/lib/jewelry-detection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectJewelrySubType } from './jewelry-detection'

test('detectJewelrySubType identifies a necklace from the Model line', () => {
  const features = ['Model: Elsa Peretti Teardrop Pendant Necklace', 'Chain length: approximately 16"']
  assert.equal(detectJewelrySubType(features), 'necklace')
})

test('detectJewelrySubType identifies a ring from the Model line', () => {
  const features = ['Model: Elsa Peretti Teardrop Bypass Ring', 'Style: Open bypass band with teardrop terminal']
  assert.equal(detectJewelrySubType(features), 'ring')
})

test('detectJewelrySubType identifies a bangle', () => {
  assert.equal(detectJewelrySubType(['Model: Hermès Enamel Bangle']), 'bangle')
})

test('detectJewelrySubType returns null when nothing matches', () => {
  assert.equal(detectJewelrySubType(['Model: Mystery Jewelry Item']), null)
})

test('detectJewelrySubType returns null for an empty list', () => {
  assert.equal(detectJewelrySubType([]), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: FAIL — `Cannot find module './jewelry-detection'`

- [ ] **Step 3: Write the implementation**

```ts
export type JewelrySubTypeHint = 'ring' | 'bangle' | 'bracelet' | 'necklace' | 'earrings' | 'pendant' | 'brooch' | 'other'

export function detectJewelrySubType(notableFeatures: string[]): JewelrySubTypeHint | null {
  const model = notableFeatures.find((f) => f.startsWith('Model:'))?.slice(7).toLowerCase() ?? ''
  if (/\bring\b/.test(model)) return 'ring'
  if (/\bbangle\b/.test(model)) return 'bangle'
  if (/\bbracelet\b/.test(model)) return 'bracelet'
  if (/\bnecklace\b/.test(model)) return 'necklace'
  if (/\bearrings?\b/.test(model)) return 'earrings'
  if (/\bpendant\b/.test(model)) return 'pendant'
  if (/\bbrooch\b/.test(model)) return 'brooch'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: PASS (5/5) — note `ring` must be checked before any other keyword since "Teardrop Bypass Ring" also isn't ambiguous, but keep the ring check first regardless since future model names could contain "pendant ring" etc.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jewelry-detection.ts src/lib/jewelry-detection.test.ts
git commit -m "feat(jewelry): add detectJewelrySubType"
```

---

## Task 4: `detectIrregularRingStyle` ✅ done (3de6c98)

**Files:**
- Modify: `src/lib/jewelry-detection.ts`
- Modify: `src/lib/jewelry-detection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/jewelry-detection.test.ts`:
```ts
import { detectIrregularRingStyle } from './jewelry-detection'

test('detectIrregularRingStyle is true for a bypass band', () => {
  const features = ['Model: Elsa Peretti Teardrop Bypass Ring', 'Style: Open bypass band with teardrop terminal']
  assert.equal(detectIrregularRingStyle(features), true)
})

test('detectIrregularRingStyle is false for a plain band', () => {
  assert.equal(detectIrregularRingStyle(['Model: Classic Gold Band Ring', 'Style: Plain polished band']), false)
})

test('detectIrregularRingStyle is false when there is no style info at all', () => {
  assert.equal(detectIrregularRingStyle(['Model: Ring']), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: FAIL — `detectIrregularRingStyle is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lib/jewelry-detection.ts`:
```ts
export function detectIrregularRingStyle(notableFeatures: string[]): boolean {
  const allText = notableFeatures.join(' ').toLowerCase()
  return /bypass|wrap(?:ped)?|open.?band|asymmetric|adjustable|toi.?et.?moi/.test(allText)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jewelry-detection.ts src/lib/jewelry-detection.test.ts
git commit -m "feat(jewelry): add detectIrregularRingStyle"
```

---

## Task 5: `parseChainLengthInches` ✅ done (0423c48)

**Files:**
- Modify: `src/lib/jewelry-detection.ts`
- Modify: `src/lib/jewelry-detection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/jewelry-detection.test.ts`. These are real production fixtures — JW-0010 and JW-0011's actual `notable_features`:
```ts
import { parseChainLengthInches } from './jewelry-detection'

test('parseChainLengthInches extracts a stated length (JW-0010 fixture)', () => {
  const features = [
    'Model: Elsa Peretti Teardrop Pendant Necklace',
    'Chain length: approximately 16"',
    'Material: Sterling silver (925)',
  ]
  assert.equal(parseChainLengthInches(features), 16)
})

test('parseChainLengthInches returns null for a qualitative-only description (JW-0011 fixture)', () => {
  const features = [
    'Model: Elsa Peretti Bean Pendant Necklace',
    'Pendant size: approximately 18 mm',
    'Chain style: fine cable chain',
  ]
  assert.equal(parseChainLengthInches(features), null)
})

test('parseChainLengthInches returns null when there is no chain info at all', () => {
  assert.equal(parseChainLengthInches(['Model: Ring']), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: FAIL — `parseChainLengthInches is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lib/jewelry-detection.ts`:
```ts
export function parseChainLengthInches(notableFeatures: string[]): number | null {
  const chainLine = notableFeatures.find((f) => /^chain length/i.test(f))
  if (!chainLine) return null
  const match = chainLine.match(/(\d+(?:\.\d+)?)/)
  return match ? parseFloat(match[1]) : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/jewelry-detection.test.ts`
Expected: PASS (11/11)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jewelry-detection.ts src/lib/jewelry-detection.test.ts
git commit -m "feat(jewelry): add parseChainLengthInches"
```

---

## Task 6: Ring diameter ↔ US size conversion ✅ done (055edd1) — follow-up idea (non-blocking): no domain-sanity range check on diameterMm, only n>=0 upstream

**Files:**
- Create: `src/lib/sizing/ring-size.ts`
- Create: `src/lib/sizing/ring-size.test.ts`

- [ ] **Step 1: Write the failing test**

These assertions are the exact numbers validated during design against Joe's real known-7.5 ring (see spec, Shared Architecture section):
```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ringDiameterMmToUsSize } from './ring-size'

test('ringDiameterMmToUsSize: single widest-point reading (18.3mm) overshoots the true size', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(18.3) - 8.2) < 0.1)
})

test('ringDiameterMmToUsSize: single narrowest-point reading (16.5mm) undershoots', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(16.5) - 6.0) < 0.1)
})

test('ringDiameterMmToUsSize: averaged reading (17.4mm) lands close to the true US 7.5', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(17.4) - 7.1) < 0.1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/sizing/ring-size.test.ts`
Expected: FAIL — `Cannot find module './ring-size'`

- [ ] **Step 3: Write the implementation**

```ts
// US ring size from inner diameter, via inner circumference.
// Formula and reference points sourced from 25karats.com / Angara.com ring-size
// guides during design (2026-08-15): US size = (circumference_mm - 36.5) / 2.55.
// Validated against a real known US 7.5 ring: averaging widest (18.3mm) and
// narrowest (16.5mm) readings on an asymmetric band gives 17.4mm -> ~7.1,
// within half a size of the true 7.5 -- see spec for the single-point-reading
// failure case this formula alone does not fix (that's detectIrregularRingStyle's job).
export function ringDiameterMmToUsSize(diameterMm: number): number {
  const circumferenceMm = Math.PI * diameterMm
  return (circumferenceMm - 36.5) / 2.55
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/sizing/ring-size.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sizing/ring-size.ts src/lib/sizing/ring-size.test.ts
git commit -m "feat(sizing): add ring diameter to US size conversion"
```

---

## Task 7: Hermès bangle size ladder ✅ done (f5f8b04) — fixed a real accent-normalization bug ('Hermès'.toLowerCase() != 'hermes') as in-scope TDD hardening

**Files:**
- Create: `src/lib/sizing/bangle-ladders.ts`
- Create: `src/lib/sizing/bangle-ladders.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapToNearestBangleSize } from './bangle-ladders'

test('snapToNearestBangleSize snaps a real Hermès Size 65 measurement (66.6mm) to 65', () => {
  const result = snapToNearestBangleSize('hermes', 66.6)
  assert.equal(result?.size, '65')
})

test('snapToNearestBangleSize returns null for an unseeded brand', () => {
  assert.equal(snapToNearestBangleSize('unknown-brand', 66.6), null)
})

test('snapToNearestBangleSize picks the nearest of three sizes', () => {
  assert.equal(snapToNearestBangleSize('hermes', 61.5)?.size, '62')
  assert.equal(snapToNearestBangleSize('hermes', 70.0)?.size, '70')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/sizing/bangle-ladders.test.ts`
Expected: FAIL — `Cannot find module './bangle-ladders'`

- [ ] **Step 3: Write the implementation**

```ts
export interface BangleSizeEntry {
  size: string
  innerDiameterMm: number
}

// Sourced 2026-08-15 from PurseForum (citing Hermès' own size guide) and
// Thrift & Tell's Hermès bracelet sizing guide during design. Validated
// against a real known Hermès Size 65 measuring 66.6mm (0.6mm gap, within
// normal tolerance) -- see spec, Feature 1. Only Hermès is seeded; extend
// with other brands the same way (source, then validate against a real
// known-size item) when one is actually encountered -- don't design ahead
// of real inventory.
export const BANGLE_SIZE_LADDERS: Record<string, BangleSizeEntry[]> = {
  hermes: [
    { size: '62', innerDiameterMm: 61 },
    { size: '65', innerDiameterMm: 66 },
    { size: '70', innerDiameterMm: 70 },
  ],
}

export function snapToNearestBangleSize(brand: string, measuredMm: number): BangleSizeEntry | null {
  const ladder = BANGLE_SIZE_LADDERS[brand.toLowerCase()]
  if (!ladder || ladder.length === 0) return null
  return ladder.reduce((closest, entry) =>
    Math.abs(entry.innerDiameterMm - measuredMm) < Math.abs(closest.innerDiameterMm - measuredMm) ? entry : closest
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/sizing/bangle-ladders.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sizing/bangle-ladders.ts src/lib/sizing/bangle-ladders.test.ts
git commit -m "feat(sizing): add Hermès bangle size ladder"
```

---

## Task 8: Shoe EU/UK↔US conversion + brand overrides ✅ done (0e128e9) — sourced from whatismysize.com, no clean sourced brand quirks found for Chanel/Gucci/LV/Louboutin (correctly left empty, documented)

This is the one task in this plan requiring a real web search at implementation time — the numbers must be sourced, not written from memory (same principle validated hard on the ring case in the spec). Do not skip the search step.

**Files:**
- Create: `src/lib/sizing/shoe-conversion.ts`
- Create: `src/lib/sizing/shoe-conversion.test.ts`

- [ ] **Step 1: Source the data**

Run a web search for `"EU to US shoe size conversion chart men's and women's"` and a second search for `"Chanel Gucci Louis Vuitton Louboutin shoe sizing runs small note"`. From the results, extract:
- A men's and a women's EU→US (and UK→US) conversion table, at minimum covering sizes EU 36–46.
- Any sourced brand-specific vanity-sizing notes for Chanel, Gucci, Louis Vuitton, and Louboutin (e.g. "runs half a size small"). If a brand has no clearly sourced quirk, omit it rather than guessing — the fallback conversion table covers it.

- [ ] **Step 2: Write the failing test**

Write tests against the values you actually sourced in Step 1 — this is a template, replace `26` and 'louboutin' 39→women's US value with your real sourced numbers:
```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertShoeSize } from './shoe-conversion'

test('convertShoeSize uses the generic table when no brand override exists', () => {
  const result = convertShoeSize({ brand: 'Nike', system: 'eu', value: 39, gender: 'womens' })
  assert.equal(result.source, 'generic')
  assert.ok(typeof result.usSize === 'number')
})

test('convertShoeSize prefers a brand override table when one exists', () => {
  const result = convertShoeSize({ brand: 'Louboutin', system: 'eu', value: 39, gender: 'womens' })
  assert.equal(result.source, 'brand')
  assert.ok(result.note)
})

test('convertShoeSize is gender-aware', () => {
  const mens = convertShoeSize({ brand: 'Nike', system: 'eu', value: 42, gender: 'mens' })
  const womens = convertShoeSize({ brand: 'Nike', system: 'eu', value: 42, gender: 'womens' })
  assert.notEqual(mens.usSize, womens.usSize)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/sizing/shoe-conversion.test.ts`
Expected: FAIL — `Cannot find module './shoe-conversion'`

- [ ] **Step 4: Write the implementation**

Fill in `SHOE_SIZE_CONVERSION` and `SHOE_BRAND_OVERRIDES` with your Step 1 sourced values, citing the source URL in a comment above each table (matching the citation style used in `ring-size.ts`/`bangle-ladders.ts`):

```ts
export interface ShoeConversionEntry {
  eu: number
  us: number
}

export interface ShoeBrandOverride {
  conversions: ShoeConversionEntry[]
  note?: string
}

// SOURCE: <fill in the URL(s) you used in Step 1>
export const SHOE_SIZE_CONVERSION: Record<'mens' | 'womens', ShoeConversionEntry[]> = {
  mens: [
    // { eu: 39, us: 6.5 }, ... fill with real sourced values
  ],
  womens: [
    // { eu: 36, us: 5.5 }, ... fill with real sourced values
  ],
}

// SOURCE: <fill in the URL(s) you used in Step 1>
export const SHOE_BRAND_OVERRIDES: Record<string, ShoeBrandOverride> = {
  // louboutin: { conversions: [...], note: 'Runs approximately half a size small vs. standard EU conversion.' },
}

function nearestUsSize(table: ShoeConversionEntry[], eu: number): number {
  const closest = table.reduce((a, b) => (Math.abs(b.eu - eu) < Math.abs(a.eu - eu) ? b : a))
  return closest.us
}

export function convertShoeSize(args: {
  brand: string
  system: 'us' | 'eu' | 'uk'
  value: number
  gender: 'mens' | 'womens'
}): { usSize: number; source: 'brand' | 'generic'; note?: string } {
  if (args.system === 'us') {
    return { usSize: args.value, source: 'generic' }
  }
  const override = SHOE_BRAND_OVERRIDES[args.brand.toLowerCase()]
  if (override) {
    return { usSize: nearestUsSize(override.conversions, args.value), source: 'brand', note: override.note }
  }
  return { usSize: nearestUsSize(SHOE_SIZE_CONVERSION[args.gender], args.value), source: 'generic' }
}
```

Note: this plan's own test fixtures (Step 2) assume a `uk` system input still resolves — if your sourced conversion tables are EU-only, convert `uk` to `eu` first via the standard UK→EU offset (UK size + 33 ≈ EU size for most footwear) before the lookup; adjust `convertShoeSize` accordingly and update the test if needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/sizing/shoe-conversion.test.ts`
Expected: PASS (3/3)

- [ ] **Step 6: Commit**

```bash
git add src/lib/sizing/shoe-conversion.ts src/lib/sizing/shoe-conversion.test.ts
git commit -m "feat(sizing): add shoe EU/UK to US conversion with brand overrides"
```

---

## Task 9: Extend `getMeasurementFields` — jewelry branch ✅ done (9007e48)

**Files:**
- Modify: `src/lib/utils.ts:32-93` (the `getMeasurementFields` function)
- Create: `src/lib/utils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMeasurementFields } from './utils'

test('getMeasurementFields: jewelry ring on a plain band asks for one ID reading', () => {
  const fields = getMeasurementFields('jewelry', 'ring', ['Model: Classic Gold Band Ring', 'Style: Plain polished band'])
  assert.ok(fields.some((f) => f.key === 'ring_inscribed_size'))
  assert.ok(fields.some((f) => f.key === 'ring_id_mm'))
  assert.equal(fields.some((f) => f.key === 'ring_id_widest_mm'), false)
})

test('getMeasurementFields: jewelry ring on an irregular band asks for widest+narrowest', () => {
  const fields = getMeasurementFields('jewelry', 'ring', ['Model: Teardrop Bypass Ring', 'Style: Open bypass band'])
  assert.ok(fields.some((f) => f.key === 'ring_id_widest_mm'))
  assert.ok(fields.some((f) => f.key === 'ring_id_narrowest_mm'))
  assert.equal(fields.some((f) => f.key === 'ring_id_mm'), false)
})

test('getMeasurementFields: jewelry bangle asks for inner diameter', () => {
  const fields = getMeasurementFields('jewelry', 'bangle', ['Model: Hermès Enamel Bangle'])
  assert.deepEqual(fields.map((f) => f.key), ['bangle_id_mm'])
})

test('getMeasurementFields: jewelry necklace asks for chain length', () => {
  const fields = getMeasurementFields('jewelry', 'necklace', ['Model: Pendant Necklace'])
  assert.deepEqual(fields.map((f) => f.key), ['necklace_chain_length_in'])
})

test('getMeasurementFields: jewelry sub-types without dedicated fields fall back to generic W/H/D', () => {
  const fields = getMeasurementFields('jewelry', 'earrings', [])
  assert.deepEqual(fields.map((f) => f.key), ['width', 'height', 'depth'])
})

test('getMeasurementFields: jewelry with no detected sub-type falls back to generic W/H/D', () => {
  const fields = getMeasurementFields('jewelry', null, [])
  assert.deepEqual(fields.map((f) => f.key), ['width', 'height', 'depth'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/utils.test.ts`
Expected: FAIL — jewelry branch doesn't exist yet, all jewelry-specific assertions fail (the last two currently pass by accident since jewelry already falls through to generic)

- [ ] **Step 3: Write the implementation**

Change the signature and add a `jewelry` branch. Full replacement of `getMeasurementFields`:

```ts
export function getMeasurementFields(
  category: string,
  subType: import('@/types/listings').ClothingSubType | import('@/types/listings').JewelrySubType | null,
  notableFeatures: string[] = []
): import('@/types/listings').MeasurementField[] {
  if (category === 'sneakers') {
    return [{ key: 'us_size', label: 'US Size', hint: 'e.g. 9.5' }]
  }
  if (category === 'jewelry') {
    switch (subType) {
      case 'ring': {
        const irregular = detectIrregularRingStyle(notableFeatures)
        const idFields = irregular
          ? [
              { key: 'ring_id_widest_mm' as const, label: 'Inner Diameter — Widest Point', hint: 'mm, at the band\'s widest point' },
              { key: 'ring_id_narrowest_mm' as const, label: 'Inner Diameter — Narrowest Point', hint: 'mm, at the band\'s narrowest point' },
            ]
          : [{ key: 'ring_id_mm' as const, label: 'Inner Diameter', hint: 'mm, single reading' }]
        return [
          { key: 'ring_inscribed_size', label: 'Inscribed Size (if stamped inside the band)', hint: 'worth checking with a magnifying glass — often present on precious-metal pieces, not universally reliable' },
          ...idFields,
        ]
      }
      case 'bangle':
        return [{ key: 'bangle_id_mm', label: 'Inner Diameter', hint: 'mm' }]
      case 'necklace':
        return [{ key: 'necklace_chain_length_in', label: 'Chain Length', hint: 'inches' }]
      default:
        return [
          { key: 'width', label: 'Width', hint: 'in inches' },
          { key: 'height', label: 'Height', hint: 'in inches' },
          { key: 'depth', label: 'Depth', hint: 'in inches' },
        ]
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
  // Everything else (handbag, small_leather_goods, electronics, keyboards,
  // collectibles, watches, other, and jewelry sub-types without dedicated
  // fields yet) — 3D dimensions
  return [
    { key: 'width', label: 'Width', hint: 'in inches' },
    { key: 'height', label: 'Height', hint: 'in inches' },
    { key: 'depth', label: 'Depth', hint: 'in inches' },
  ]
}
```

Add the import at the top of `src/lib/utils.ts`:
```ts
import { detectIrregularRingStyle } from './jewelry-detection'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/utils.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Run the full existing test suite to check for regressions**

Run: `node --experimental-strip-types --test src/lib/pipeline/gate-messages.test.ts`
Expected: FAIL at this point — `gate-messages.ts` still calls `getMeasurementFields(category, clothingSubTypeHint)` with the old 2-arg signature and old field name. This is expected; Task 10 fixes it. Do not fix `gate-messages.ts` in this task — keep the diff focused on `utils.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(utils): add jewelry branch to getMeasurementFields"
```

---

## Task 10: Extend `getMeasurementFields` — shoe sizing-system picker ✅ done (9f8d477) — discovered real bug: MeasurementFields.tsx's mm-conversion only exempts key 'us_size', not new 'shoe_size_raw' → metric-preference users would get shoe sizes silently mangled. Fix folded into Task 11 below.

**Files:**
- Modify: `src/lib/utils.ts` (sneakers branch)
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('getMeasurementFields: sneakers asks for a sizing system and a size value', () => {
  const fields = getMeasurementFields('sneakers', null, [])
  const systemField = fields.find((f) => f.key === 'shoe_size_system')
  assert.ok(systemField)
  assert.equal(systemField?.useChips, true)
  assert.ok(systemField?.chipOptions?.includes('US'))
  assert.ok(systemField?.chipOptions?.includes('EU'))
  assert.ok(fields.some((f) => f.key === 'shoe_size_raw'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/utils.test.ts`
Expected: FAIL — sneakers branch still only returns `us_size`

- [ ] **Step 3: Write the implementation**

Replace the sneakers branch in `getMeasurementFields`:
```ts
  if (category === 'sneakers') {
    return [
      { key: 'shoe_size_system', label: 'Sizing System', hint: 'which system is printed on the tag', useChips: true, chipOptions: ['US', 'EU', 'UK'] },
      { key: 'shoe_size_raw', label: 'Size (as printed)', hint: 'e.g. 39, 6.5, 8.5' },
      { key: 'us_size', label: 'US Size (if directly on the tag)', hint: 'skip if only EU/UK is shown — this gets computed otherwise' },
    ]
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/utils.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(utils): add shoe sizing-system picker fields"
```

---

## Task 11: `MeasurementFields.tsx` — `defaultValues` prop for necklace chain-length pre-fill ✅ done (c8c4ea8) — also fixed real bug: units.ts's formatMeasurementValue had the same us_size-only exemption gap, reachable through 4 live call sites incl. agent-chat/draft-listing pipeline. Follow-up idea: ring_inscribed_size renders as type=number input but can hold non-numeric stamps (e.g. "6 1/4").

**Files:**
- Modify: `src/components/workspace/MeasurementFields.tsx`

- [ ] **Step 1: Update the props interface**

Change:
```ts
interface MeasurementFieldsProps {
  fields: MeasurementField[]
  inputUnit: 'imperial' | 'metric'
  onSubmit: (measurements: Partial<Measurements>) => void
}
```
to:
```ts
interface MeasurementFieldsProps {
  fields: MeasurementField[]
  inputUnit: 'imperial' | 'metric'
  onSubmit: (measurements: Partial<Measurements>) => void
  defaultValues?: Partial<Record<string, string | number>>
}
```

- [ ] **Step 2: Use it in the component**

Change the function signature and initial state:
```ts
export function MeasurementFields({ fields, inputUnit, onSubmit, defaultValues }: Readonly<MeasurementFieldsProps>) {
  const [values, setValues] = useState<Record<string, string | number>>(defaultValues ?? {})
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep MeasurementFields`
Expected: no output (no errors referencing this file)

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/MeasurementFields.tsx
git commit -m "feat(ui): support pre-filled default values in MeasurementFields"
```

---

## Task 12: Wire jewelry/shoe detection into `gate-messages.ts` ✅ done (f3627c0)

**Files:**
- Modify: `src/lib/pipeline/gate-messages.ts`

- [ ] **Step 1: Update the sub-type detection and field-selection call**

Replace:
```ts
  const clothingSubTypeHint = category === 'clothing' ? detectClothingSubType(notableFeatures) : null
  const measurementFields = getMeasurementFields(category, clothingSubTypeHint)
```
with:
```ts
  const subTypeHint =
    category === 'clothing' ? detectClothingSubType(notableFeatures)
    : category === 'jewelry' ? detectJewelrySubType(notableFeatures)
    : null
  const measurementFields = getMeasurementFields(category, subTypeHint, notableFeatures)
```

- [ ] **Step 2: Update the `DetailGateContext` construction**

Replace:
```ts
  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    clothingSubTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
  }
```
with:
```ts
  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    subTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
  }
```

- [ ] **Step 3: Update the import**

Replace:
```ts
import { detectClothingSubType, getMeasurementFields } from '@/lib/utils'
```
with:
```ts
import { detectClothingSubType, getMeasurementFields } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
```

- [ ] **Step 4: Update `gate-messages.test.ts`'s two `detailGateContext`-destructuring tests**

In `src/lib/pipeline/gate-messages.test.ts`, the tests `'buildGenderGatePrompt asks for gender and size when the category needs both'` and `'buildGenderGatePrompt asks for measurements only when the category needs no gender'` only assert on `message`, not on `detailGateContext.clothingSubTypeHint` directly — check by running the suite first before assuming a change is needed.

- [ ] **Step 5: Run the full existing test suite**

Run: `node --experimental-strip-types --test src/lib/pipeline/gate-messages.test.ts`
Expected: PASS — if it fails, it's because a test asserts on the old `clothingSubTypeHint` field name; update that assertion to `subTypeHint` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/gate-messages.ts src/lib/pipeline/gate-messages.test.ts
git commit -m "feat(gate): detect jewelry sub-type and thread notableFeatures into field selection"
```

---

## Task 13: Fix remaining `clothing_sub_type` read call sites ✅ done (6928fcf) — 0 tsc errors project-wide. Found package.json's `npm test` glob silently only runs 3/11 test files under sh (no globstar) — follow-up idea. Also extracted shared notableFeaturesOf export while fixing agent/tools.ts gap.

**Files:**
- Modify: `src/lib/pipeline/step4a-draft-listing.ts:61,65-68`
- Modify: `src/components/workspace/FieldsPanel.tsx:87-88`
- Modify: `src/lib/agent/tools.ts:134,156-159`

- [ ] **Step 1: `step4a-draft-listing.ts`**

Change the select query:
```ts
    .select('measurements, clothing_sub_type')
```
to:
```ts
    .select('measurements, sub_type')
```

Change the `getMeasurementFields` call:
```ts
  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.clothing_sub_type ?? null) as ClothingSubType | null
  )
```
to:
```ts
  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    step2.notableFeatures
  )
```

Update the import:
```ts
import type { ClothingSubType } from '@/types/listings'
```
to:
```ts
import type { ClothingSubType, JewelrySubType } from '@/types/listings'
```

- [ ] **Step 2: `FieldsPanel.tsx`**

Change:
```ts
  const measurementFields = getMeasurementFields(listing.category ?? '', listing.clothing_sub_type)
```
to:
```ts
  const measurementFields = getMeasurementFields(listing.category ?? '', listing.sub_type, notableFeaturesOfListing(listing))
```
This introduces a need for `notableFeaturesOfListing` — check whether `FieldsPanel.tsx` already has access to `notable_features` (it doesn't take `intake_meta` as a prop today; check the `Listing` object it receives — if `listing.intake_meta` is available, reuse the same extraction logic as `gate-messages.ts`'s `notableFeaturesOf`. If `FieldsPanel`'s `listing` prop type doesn't include `intake_meta`, pass `[]` instead — this only affects whether ring/necklace show the irregular/pre-fill variant in read-only display, not correctness of stored data, so degrading gracefully to the plain-band/no-prefill field set here is acceptable.

- [ ] **Step 3: `agent/tools.ts`**

Change the select query:
```ts
    .select('brand, category, condition, condition_notes, tags, inclusions, measurements, clothing_sub_type, suggested_price_cents, platform_fields')
```
to:
```ts
    .select('brand, category, condition, condition_notes, tags, inclusions, measurements, sub_type, suggested_price_cents, platform_fields')
```

Change:
```ts
  const measurementFields = getMeasurementFields(
    (listing.category as string) ?? '',
    (listing.clothing_sub_type ?? null) as ClothingSubType | null
  )
```
to:
```ts
  const measurementFields = getMeasurementFields(
    (listing.category as string) ?? '',
    (listing.sub_type ?? null) as ClothingSubType | JewelrySubType | null
  )
```
(no `notableFeatures` available at this call site today — passing none is fine, same graceful-degradation reasoning as Step 2)

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the full test suite**

Run: `node --experimental-strip-types --test src/**/*.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/step4a-draft-listing.ts src/components/workspace/FieldsPanel.tsx src/lib/agent/tools.ts
git commit -m "fix: update remaining clothing_sub_type call sites to sub_type"
```

---

## Task 14: Write `sub_type` on gate confirmation (fixes the write-path bug) ✅ done (18ded7b) — the actual bugfix, 0 tsc errors project-wide, LLM fallback uses haiku

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts`

- [ ] **Step 1: Compute and store `sub_type` in the `store-gender` step**

Replace:
```ts
    if (genderConfirmation) {
      const gd = (genderConfirmation as unknown as {
        data: { gender?: string; measurements?: Record<string, unknown> | null }
      }).data
      gender = needsGender ? (gd.gender ?? null) : null
      measurements = gd.measurements ?? null
      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements }).eq('id', listingId)
      )
    }
```
with:
```ts
    if (genderConfirmation) {
      const gd = (genderConfirmation as unknown as {
        data: { gender?: string; measurements?: Record<string, unknown> | null }
      }).data
      gender = needsGender ? (gd.gender ?? null) : null
      measurements = gd.measurements ?? null

      const category = (step2Result.category ?? '').toLowerCase()
      let subType: string | null =
        category === 'clothing' ? detectClothingSubType(step2Result.notableFeatures)
        : category === 'jewelry' ? detectJewelrySubType(step2Result.notableFeatures)
        : null

      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements, sub_type: subType }).eq('id', listingId)
      )

      // Jewelry sub-type LLM fallback: regex is validated reliable on real
      // data (see spec), so this only fires on the rare miss. Runs after the
      // gate has already been confirmed -- never blocks gate rendering or
      // the confirm flow, just enriches the stored value if regex found
      // nothing. See spec, Shared Architecture: "LLM generates guidance,
      // never asserts sizing facts" -- classification is a judgment call,
      // not a fabricated measurement, so this is in-bounds for the LLM.
      if (subType === null && category === 'jewelry') {
        await step.run('jewelry-subtype-llm-fallback', async () => {
          try {
            const llmSubType = await classifyJewelrySubTypeWithLlm(step2Result.notableFeatures, apiKeys)
            if (llmSubType) {
              await supabase.from('listings').update({ sub_type: llmSubType }).eq('id', listingId)
            }
          } catch (err) {
            console.error('jewelry-subtype-llm-fallback failed for listing', listingId, err)
          }
        })
      }
    }
```

- [ ] **Step 2: Add the imports**

```ts
import { detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { classifyJewelrySubTypeWithLlm } from '@/lib/jewelry-llm-fallback'
```

- [ ] **Step 3: Write the LLM fallback helper**

Create `src/lib/jewelry-llm-fallback.ts`:
```ts
import { runStructured } from '@/lib/claude'
import type { ApiKeys } from '@/lib/user-api-keys'
import type { JewelrySubType } from '@/types/listings'

const VALID_SUB_TYPES: JewelrySubType[] = ['ring', 'bangle', 'bracelet', 'necklace', 'earrings', 'pendant', 'brooch', 'other']

export async function classifyJewelrySubTypeWithLlm(
  notableFeatures: string[],
  apiKeys: ApiKeys
): Promise<JewelrySubType | null> {
  const result = await runStructured<{ sub_type: string }>({
    model: 'claude-sonnet-4-6',
    apiKey: apiKeys.anthropic,
    maxTokens: 100,
    toolName: 'classify_jewelry_sub_type',
    toolDescription: 'Classify a jewelry item into a sub-type based on its description.',
    prompt: `Classify this jewelry item into exactly one sub-type based on its description. Respond with one of: ${VALID_SUB_TYPES.join(', ')}.\n\nDescription:\n${notableFeatures.join('\n')}`,
    jsonSchema: {
      type: 'object',
      properties: {
        sub_type: { type: 'string', enum: VALID_SUB_TYPES },
      },
      required: ['sub_type'],
    },
  })
  return VALID_SUB_TYPES.includes(result.sub_type as JewelrySubType) ? (result.sub_type as JewelrySubType) : null
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual smoke test**

This step touches an Inngest function and an LLM call, which aren't practically unit-testable in isolation without substantial mocking infrastructure that doesn't exist in this codebase yet — matches how `intake-pipeline.ts` has no existing unit tests today (it's exercised end-to-end in production). Confirm by reading the diff that: (a) `sub_type` is written in the same `update()` call as the existing `gender`/`measurements` write, so no new failure mode is introduced for non-jewelry categories, (b) the LLM fallback step only fires when `category === 'jewelry' && subType === null`, and (c) a thrown error inside the fallback step's try/catch never fails the whole Inngest function (already wrapped).

- [ ] **Step 6: Commit**

```bash
git add src/lib/inngest/functions/intake-pipeline.ts src/lib/jewelry-llm-fallback.ts
git commit -m "fix: write sub_type on gate confirmation, with LLM fallback for jewelry"
```

---

## Task 15: Backfill `sub_type` for existing listings ✅ done (608f95b) — applied to production, dry-run validated first, 10 jewelry + baked-in 1 clothing = 11 backfilled, 1 jewelry listing (no parseable Model line) remains null as known limitation

**Files:**
- Create: `supabase/migrations/0017_sub_type_backfill.sql`

- [ ] **Step 1: Write the backfill migration**

`detectClothingSubType`/`detectJewelrySubType` are regex-only and deterministic, so this can run as plain SQL rather than needing an app-level script — the same keyword patterns from `src/lib/utils.ts`/`src/lib/jewelry-detection.ts`, translated to Postgres regex against the `Model:` line already stored in `intake_meta->'visionAnalysis'->'notable_features'`:

```sql
-- Backfill sub_type for existing listings using the same regex patterns as
-- detectClothingSubType/detectJewelrySubType (src/lib/utils.ts,
-- src/lib/jewelry-detection.ts). Only touches rows that are currently NULL,
-- so it's safe to re-run.
WITH model_lines AS (
  SELECT
    id,
    category,
    lower(
      regexp_replace(
        (SELECT value FROM jsonb_array_elements_text(intake_meta->'visionAnalysis'->'notable_features') AS value WHERE value LIKE 'Model:%' LIMIT 1),
        '^Model:\s*', ''
      )
    ) AS model
  FROM listings
  WHERE sub_type IS NULL
)
UPDATE listings l
SET sub_type = CASE
  WHEN m.category = 'clothing' AND m.model ~ '\yjeans?\y|denim|\y5[0-9][0-9]\y' THEN 'jeans'
  WHEN m.category = 'clothing' AND m.model ~ '\yshorts?\y' THEN 'shorts'
  WHEN m.category = 'clothing' AND m.model ~ 'formal.*pant|dress.*pant|trousers?|slacks?' THEN 'pants_formal'
  WHEN m.category = 'clothing' AND m.model ~ '\ypants?\y|\ychinos?\y|\ykhakis?\y' THEN 'pants'
  WHEN m.category = 'clothing' AND m.model ~ 't.?shirt|tee\y|crew.?neck' THEN 'tshirt'
  WHEN m.category = 'clothing' AND m.model ~ '\yshirt\y|button.?down|oxford|polo|dress\s+shirt' THEN 'shirt'
  WHEN m.category = 'clothing' AND m.model ~ '\ydress\y' THEN 'dress'
  WHEN m.category = 'clothing' AND m.model ~ 'jacket|blazer|\ycoat\y|hoodie|sweatshirt' THEN 'jacket'
  WHEN m.category = 'clothing' AND m.model ~ '\yskirt\y' THEN 'skirt'
  WHEN m.category = 'jewelry' AND m.model ~ '\yring\y' THEN 'ring'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybangle\y' THEN 'bangle'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybracelet\y' THEN 'bracelet'
  WHEN m.category = 'jewelry' AND m.model ~ '\ynecklace\y' THEN 'necklace'
  WHEN m.category = 'jewelry' AND m.model ~ '\yearrings?\y' THEN 'earrings'
  WHEN m.category = 'jewelry' AND m.model ~ '\ypendant\y' THEN 'pendant'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybrooch\y' THEN 'brooch'
  ELSE NULL
END
FROM model_lines m
WHERE l.id = m.id AND m.model IS NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0017_sub_type_backfill.sql`
Expected: `UPDATE <n>` where n is the count of listings that got a non-null match

- [ ] **Step 3: Spot-check against the real fixtures used in this plan's tests**

Run:
```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -t -c "SELECT sku, sub_type FROM listings WHERE sku IN ('JW-0010','JW-0011','JW-0012');"
```
Expected: `JW-0010 | necklace`, `JW-0011 | necklace`, `JW-0012 | ring`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0017_sub_type_backfill.sql
git commit -m "feat(db): backfill sub_type for existing listings"
```

---

## Task 16: Full regression pass ✅ done — tsc clean (0 errors, full project), lint clean (1 pre-existing unrelated error in ListingsGrid.tsx from May, 55 pre-existing warnings), 98/98 tests passing (ran directly via `find src -name "*.test.ts"` since npm test's glob is broken under sh — see Task 13 follow-up note). Pushed, HEAD at 608f95b.

Follow-up bd tickets filed: `ai-listings-5iy` (ring_inscribed_size numeric-input mismatch), `ai-listings-b27` (no domain-sanity range check on ring diameter), `ai-listings-aqz` (npm test glob broken). 1 jewelry listing (no parseable Model line) remains sub_type=null after backfill — expected, not filed.

**Final holistic review (across all 16 commits) found two real, undisclosed cross-commit gaps — added as Tasks 17-18 before Plan A is considered done:**

## Task 17: Fix jewelry mm fields not exempted from inches↔mm conversion (units.ts)

Task 11 fixed the `shoe_size_raw`/`ring_inscribed_size`/`us_size` exemption gap in `NON_LENGTH_FIELD_KEYS` (`src/lib/units.ts`), but never revisited it for the jewelry mm fields Task 9 added two commits earlier: `ring_id_mm`, `ring_id_widest_mm`, `ring_id_narrowest_mm`, `bangle_id_mm`. These fields are natively mm (per spec's Data Model: "Jewelry fields embed their unit in the key name... unlike clothing's unitless keys"), but since they're not exempted, `MeasurementFields.tsx`'s submit logic runs them through `mmToInches()` when the user's global unit preference is metric (corrupting the stored value), and `formatMeasurementValue` always displays them via `formatDualMeasurement`, which assumes the stored number IS inches — producing nonsense like "18.3 in (465 mm)" for what should just read "18.3mm". This reaches gate-confirmation chat text, `FieldsPanel` display, and the `step4a-draft-listing.ts` prompt that generates the actual eBay/Poshmark description. `units.test.ts` currently locks in the broken behavior as a passing "regression" test.

**Fix:** add the 4 jewelry mm keys to `NON_LENGTH_FIELD_KEYS` in `src/lib/units.ts`, update the misleading test in `units.test.ts` to assert the correct passthrough behavior instead, add tests for the 4 new keys.

## Task 18: Wire necklace chain-length pre-fill end-to-end

`parseChainLengthInches` (Task 5) and `MeasurementFields`'s `defaultValues` prop (Task 11) both exist and pass their isolated tests, but nothing connects them — `gate-messages.ts` never calls `parseChainLengthInches`, `DetailGateContext` has no field to carry a default value, and `AgentChat.tsx` never passes `defaultValues` to `<MeasurementFields>`. JW-0010 (parseable chain length) and JW-0011 (unparseable) currently present an identical blank input — the "near-zero extra effort when parsing succeeds" the spec describes for necklaces doesn't actually happen yet.

**Fix:** add `defaultMeasurementValues?: Partial<Record<string, string | number>>` to `DetailGateContext` (`src/types/listings.ts`); in `gate-messages.ts`'s `buildGenderGatePrompt`, when `subTypeHint === 'necklace'`, call `parseChainLengthInches(notableFeatures)` and populate `defaultMeasurementValues` if non-null; wire `AgentChat.tsx` to read it and pass as `<MeasurementFields defaultValues={...}>`.

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 2: Full lint**

Run: `npx eslint . --ext .ts,.tsx` (or this repo's configured lint command — check `package.json` `scripts.lint`)
Expected: clean

- [ ] **Step 3: Full test suite**

Run: `node --experimental-strip-types --test src/**/*.test.ts`
Expected: all PASS, including the pre-existing `gate-messages.test.ts` suite untouched by this plan's field-selection changes

- [ ] **Step 4: Push the branch**

```bash
git push
```

---

## Self-Review Notes

- **Spec coverage:** Feature 1 (jewelry fields) — Tasks 3, 4, 5, 6, 7, 9, 11, 12. Feature 2 (shoe sizing capture/conversion) — Tasks 8, 10, 12 (brand-quirk notes plumbing into step4a's description is explicitly deferred to the sizing-table-in-listing-generation plan, per the spec's own sequencing). `sub_type` rename + write-path bugfix — Tasks 1, 2, 13, 14, 15. The "Can't find sizing" LLM navigational-guidance fallback (spec, Feature 2) is a small remaining gap — not included as a task here since it's a gate-UI escape-hatch button wired to a chat-style LLM call, which depends on how the shoe capture UI actually renders the system picker (a frontend task better sequenced with real UI work, not a pure-function TDD task). Flagging this as a known gap to close in this same plan's execution if a dedicated task turns out to be needed once Task 10's fields are wired into the actual gate UI component (not just `getMeasurementFields`).
- **Placeholder scan:** Task 8's conversion tables are intentionally left for real-time sourcing (per the spec's "never fabricated" principle) but every other step has complete, runnable code.
- **Type consistency:** `sub_type` / `subTypeHint` / `JewelrySubType` / `ClothingSubType` naming is consistent across Tasks 1, 2, 9, 12, 13, 14. `getMeasurementFields`'s 3-arg signature (`category, subType, notableFeatures`) is consistent from Task 9 onward.
