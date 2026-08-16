# Shoe Sizing Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two real gaps found in `docs/superpowers/specs/2026-08-15-jewelry-shoe-measurement-gate-design.md`'s "Sizing Data in Listing Generation" section — `us_size` is never computed server-side despite the gate field's own hint promising it ("skip if only EU/UK is shown — this gets computed otherwise"), and `step4a`'s prompt has no mechanism for a multi-system (EU/UK/US) sizing table or brand-quirk note, only a flat single-value line.

**Architecture:** `convertShoeSize` (already shipped, currently unused anywhere in the app) is extended to return the full EU/UK/US row instead of just `usSize`. Two new pure, unit-testable functions are added alongside it: `deriveShoeUsSizeForStorage` (called at gate-confirmation write time in `intake-pipeline.ts` to backfill `us_size` when the user only entered EU/UK) and `buildShoeSizingPromptSection` (called at `step4a` read time to build the multi-system sizing block for the LLM prompt). Both new functions take plain data in and return plain data out — no Supabase/Inngest coupling — so they're tested directly without mocking pipeline machinery.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` (matches existing `shoe-conversion.test.ts`), Inngest step functions, Supabase.

**Note on scope:** Per Joe's explicit call, `SHOE_BRAND_OVERRIDES` stays empty — no brand-quirk notes are seeded in this plan (a second web-research pass found LV heels/pumps running ~0.5 size small repeated across independent blogs/reseller Q&As, but none of it is brand-published, and it's per-style not per-brand, which the current per-brand `note` field can't express anyway). The `note` plumbing is still wired end-to-end so it activates automatically the day a real sourced override is added — no code changes needed then, just data.

---

## Task 1: Extend `convertShoeSize` to return the full EU/UK/US row

**Files:**
- Modify: `src/lib/sizing/shoe-conversion.ts:88-136` (add `nearestEuForUs`, extend `convertShoeSize`'s return type and both branches)
- Test: `src/lib/sizing/shoe-conversion.test.ts`

Today `convertShoeSize` returns only `{ usSize, source, note? }`. The EU value is computed internally as an intermediate (`euValue`) but thrown away, and the `'us'` input branch short-circuits before computing it at all. This task makes `euSize`/`ukSize` real, always-present outputs by adding a reverse (US→EU) lookup for the `'us'` branch and reusing the already-computed `euValue` for the `'eu'`/`'uk'` branches.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/sizing/shoe-conversion.test.ts` (after the existing last test, which ends at line 77):

```ts
test('convertShoeSize returns the EU and UK legs alongside the US size (EU input)', () => {
  const result = convertShoeSize({ brand: 'Nike', system: 'eu', value: 39, gender: 'womens' })
  assert.equal(result.euSize, 39)
  // UK is derived via the same EU-33 approximation used elsewhere in this file.
  assert.equal(result.ukSize, 6)
})

test('convertShoeSize returns the EU and UK legs alongside the US size (UK input)', () => {
  // UK 8 -> EU 41 (UK+33 offset) -> round-trips back to UK 8 exactly.
  const result = convertShoeSize({ brand: 'Nike', system: 'uk', value: 8, gender: 'mens' })
  assert.equal(result.euSize, 41)
  assert.equal(result.ukSize, 8)
})

test('convertShoeSize derives the EU/UK legs via reverse lookup for a US-system input', () => {
  // US men's 9 is an exact table entry at EU 42.5 (see SHOE_SIZE_CONVERSION.mens).
  const result = convertShoeSize({ brand: 'Nike', system: 'us', value: 9, gender: 'mens' })
  assert.equal(result.usSize, 9)
  assert.equal(result.euSize, 42.5)
  assert.equal(result.ukSize, 9.5)
})

test('convertShoeSize keeps the EU leg as the passthrough value even when a brand override changes the US leg', () => {
  const fakeBrand = 'test-brand-with-override'
  SHOE_BRAND_OVERRIDES[fakeBrand] = {
    conversions: { mens: [], womens: [{ eu: 39, us: 99 }] },
    note: 'test fixture',
  }
  try {
    const result = convertShoeSize({ brand: fakeBrand, system: 'eu', value: 39, gender: 'womens' })
    assert.equal(result.usSize, 99)
    assert.equal(result.euSize, 39)
    assert.equal(result.ukSize, 6)
  } finally {
    delete SHOE_BRAND_OVERRIDES[fakeBrand]
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: FAIL — 4 new failures, `TypeError` or `undefined` comparisons on `result.euSize`/`result.ukSize` (the fields don't exist yet).

- [ ] **Step 3: Implement `nearestEuForUs` and extend `convertShoeSize`**

In `src/lib/sizing/shoe-conversion.ts`, insert a new function directly after `nearestUsSize` (which ends at line 100, right before the `ukToEu` comment block at line ~102):

```ts
// Reverse of nearestUsSize -- same nearest-match/empty-table-guard shape, just comparing the
// `.us` field instead of `.eu`. Needed so a raw US-system input (which today's field hint
// explicitly allows: "skip if only EU/UK is shown") can still produce an EU/UK display row.
function nearestEuForUs(table: ShoeConversionEntry[], us: number): number | null {
  if (table.length === 0) return null
  const closest = table.reduce((a, b) => (Math.abs(b.us - us) < Math.abs(a.us - us) ? b : a))
  return closest.eu
}
```

Then replace the existing `convertShoeSize` function (currently lines 118-136) with:

```ts
export function convertShoeSize(args: {
  brand: string
  system: 'us' | 'eu' | 'uk'
  value: number
  gender: 'mens' | 'womens'
}): { usSize: number; euSize: number; ukSize: number; source: 'brand' | 'generic'; note?: string } {
  if (args.system === 'us') {
    const euValue = nearestEuForUs(SHOE_SIZE_CONVERSION[args.gender], args.value)
    if (euValue === null) {
      throw new Error(`No generic shoe size conversion table entries for gender "${args.gender}"`)
    }
    return { usSize: args.value, euSize: euValue, ukSize: euValue - 33, source: 'generic' }
  }
  const euValue = args.system === 'uk' ? ukToEu(args.value) : args.value
  const override = SHOE_BRAND_OVERRIDES[normalizeBrandKey(args.brand)]
  const brandUsSize = override ? nearestUsSize(override.conversions[args.gender], euValue) : null
  if (brandUsSize !== null) {
    return { usSize: brandUsSize, euSize: euValue, ukSize: euValue - 33, source: 'brand', note: override?.note }
  }
  const genericUsSize = nearestUsSize(SHOE_SIZE_CONVERSION[args.gender], euValue)
  if (genericUsSize === null) {
    throw new Error(`No generic shoe size conversion table entries for gender "${args.gender}"`)
  }
  return { usSize: genericUsSize, euSize: euValue, ukSize: euValue - 33, source: 'generic' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: PASS — all tests in the file (the original 7 plus the 4 new ones) green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`convertShoeSize`'s return type gained fields, it didn't lose any, so existing callers — none exist yet outside this file and its test — are unaffected.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/sizing/shoe-conversion.ts src/lib/sizing/shoe-conversion.test.ts
git commit -m "feat(sizing): return full EU/UK/US row from convertShoeSize"
```

---

## Task 2: Add `deriveShoeUsSizeForStorage`

**Files:**
- Modify: `src/lib/sizing/shoe-conversion.ts` (new function, append after `convertShoeSize`)
- Test: `src/lib/sizing/shoe-conversion.test.ts`

Pure function: given a listing's category, gender, brand, and raw `measurements`, returns an updated `measurements` object with `us_size` backfilled from `shoe_size_system`/`shoe_size_raw` — or `null` if there's nothing to do (wrong category, `us_size` already present, or the raw fields are missing/unusable). Called from the pipeline in Task 3; tested here in isolation.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/sizing/shoe-conversion.test.ts`:

```ts
import { deriveShoeUsSizeForStorage } from './shoe-conversion'

test('deriveShoeUsSizeForStorage returns null for a non-sneakers category', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'clothing',
    gender: 'womens',
    brand: 'Nike',
    measurements: { shoe_size_system: 'eu', shoe_size_raw: '39' },
  })
  assert.equal(result, null)
})

test('deriveShoeUsSizeForStorage returns null when us_size is already present (respects a directly-entered value)', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'sneakers',
    gender: 'womens',
    brand: 'Nike',
    measurements: { shoe_size_system: 'eu', shoe_size_raw: '39', us_size: 8 },
  })
  assert.equal(result, null)
})

test('deriveShoeUsSizeForStorage returns null when the raw system/value fields are missing', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'sneakers',
    gender: 'womens',
    brand: 'Nike',
    measurements: { item_length_in: 10 },
  })
  assert.equal(result, null)
})

test('deriveShoeUsSizeForStorage returns null when gender is missing (sneakers requires it, but guard defensively)', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'sneakers',
    gender: null,
    brand: 'Nike',
    measurements: { shoe_size_system: 'eu', shoe_size_raw: '39' },
  })
  assert.equal(result, null)
})

test('deriveShoeUsSizeForStorage computes and merges us_size from an EU raw value, preserving other keys', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'sneakers',
    gender: 'womens',
    brand: 'Nike',
    measurements: { shoe_size_system: 'EU', shoe_size_raw: '39', item_length_in: 10 },
  })
  assert.ok(result)
  assert.equal(result!.us_size, 8)
  assert.equal(result!.item_length_in, 10)
  assert.equal(result!.shoe_size_system, 'EU')
})

test('deriveShoeUsSizeForStorage computes us_size from a UK raw value', () => {
  const result = deriveShoeUsSizeForStorage({
    category: 'sneakers',
    gender: 'mens',
    brand: 'Nike',
    measurements: { shoe_size_system: 'UK', shoe_size_raw: '8' },
  })
  assert.ok(result)
  assert.equal(result!.us_size, 8)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: FAIL — `deriveShoeUsSizeForStorage is not a function` / import error.

- [ ] **Step 3: Implement `deriveShoeUsSizeForStorage`**

Append to `src/lib/sizing/shoe-conversion.ts`, after `convertShoeSize`:

```ts
// Backfills `us_size` at gate-confirmation write time when the shopper only entered an EU/UK
// size -- the measurement field's own hint promises this ("skip if only EU/UK is shown -- this
// gets computed otherwise") but nothing called convertShoeSize to actually do it. Returns null
// (no-op) rather than a copy of the input when there's nothing to compute, so callers can do
// `if (result) measurements = result` without a redundant no-op assignment.
export function deriveShoeUsSizeForStorage(args: {
  category: string
  gender: string | null
  brand: string
  measurements: Record<string, unknown> | null
}): Record<string, unknown> | null {
  if (args.category !== 'sneakers' || !args.measurements) return null
  const m = args.measurements
  if (typeof m.us_size === 'number' && !Number.isNaN(m.us_size)) return null
  const rawSystem = typeof m.shoe_size_system === 'string' ? m.shoe_size_system.toLowerCase() : null
  if (rawSystem !== 'us' && rawSystem !== 'eu' && rawSystem !== 'uk') return null
  const rawValue = typeof m.shoe_size_raw === 'string' ? Number.parseFloat(m.shoe_size_raw) : null
  if (rawValue === null || Number.isNaN(rawValue)) return null
  if (args.gender !== 'mens' && args.gender !== 'womens') return null
  const converted = convertShoeSize({ brand: args.brand, system: rawSystem, value: rawValue, gender: args.gender })
  return { ...m, us_size: converted.usSize }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: PASS — all tests green (7 original + 4 from Task 1 + 6 new = 17 tests in this file).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sizing/shoe-conversion.ts src/lib/sizing/shoe-conversion.test.ts
git commit -m "feat(sizing): add deriveShoeUsSizeForStorage to backfill us_size from EU/UK input"
```

---

## Task 3: Wire `deriveShoeUsSizeForStorage` into the intake pipeline

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts:1-15` (import) and `:138-156` (store-gender block)

- [ ] **Step 1: Add the import**

In `src/lib/inngest/functions/intake-pipeline.ts`, add to the existing import block (after the `computeEstimatedShippingBox` import on line 13):

```ts
import { deriveShoeUsSizeForStorage } from '@/lib/sizing/shoe-conversion'
```

- [ ] **Step 2: Call it in the store-gender block**

The current block (lines 138-156) reads:

```ts
      gender = needsGender ? (gd.gender ?? null) : null
      measurements = gd.measurements ?? null

      const category = (step2Result.category ?? '').toLowerCase()
      const subType: ClothingSubType | JewelrySubType | null =
        category === 'clothing' ? detectClothingSubType(step2Result.notableFeatures)
        : category === 'jewelry' ? detectJewelrySubType(step2Result.notableFeatures)
        : null

      const estimatedShippingBox = computeEstimatedShippingBox(category, measurements as Measurements | null)
```

Insert the shoe-size backfill between the `subType` computation and the `estimatedShippingBox` computation, so the (possibly-updated) `measurements` flows into the box computation too:

```ts
      gender = needsGender ? (gd.gender ?? null) : null
      measurements = gd.measurements ?? null

      const category = (step2Result.category ?? '').toLowerCase()
      const subType: ClothingSubType | JewelrySubType | null =
        category === 'clothing' ? detectClothingSubType(step2Result.notableFeatures)
        : category === 'jewelry' ? detectJewelrySubType(step2Result.notableFeatures)
        : null

      const shoeSizeMeasurements = deriveShoeUsSizeForStorage({
        category,
        gender,
        brand: step2Result.brand,
        measurements,
      })
      if (shoeSizeMeasurements) {
        measurements = shoeSizeMeasurements
      }

      const estimatedShippingBox = computeEstimatedShippingBox(category, measurements as Measurements | null)
```

Nothing else in the block changes — `measurementsWithShippingBox` and the `store-gender` `supabase.from('listings').update(...)` call already reference `measurements` by the same variable, so they pick up the backfilled value automatically.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Run the full test suite (no unit tests target this file directly — Inngest step functions aren't unit-tested in this codebase; Task 2's tests already cover the pure logic this step delegates to)**

Run: `npm test`
Expected: PASS, same count as after Task 2, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inngest/functions/intake-pipeline.ts
git commit -m "feat(pipeline): backfill shoe us_size server-side at gender-gate confirmation"
```

---

## Task 4: Add `buildShoeSizingPromptSection`

**Files:**
- Modify: `src/lib/sizing/shoe-conversion.ts` (new function, append after `deriveShoeUsSizeForStorage`)
- Test: `src/lib/sizing/shoe-conversion.test.ts`

Pure function: given category/brand/gender/measurements, returns either `''` (nothing to show) or a formatted multi-line block — `\n- Sizing: EU 39 · UK 6 · US 8.5` plus, when a brand override note exists, a second `\n- Sizing note: ...` line. This is what gets appended to `step4a`'s prompt in Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/sizing/shoe-conversion.test.ts`:

```ts
import { buildShoeSizingPromptSection } from './shoe-conversion'

test('buildShoeSizingPromptSection returns empty string for a non-sneakers category', () => {
  const result = buildShoeSizingPromptSection({
    category: 'clothing',
    brand: 'Nike',
    gender: 'womens',
    measurements: { shoe_size_system: 'eu', shoe_size_raw: '39' },
  })
  assert.equal(result, '')
})

test('buildShoeSizingPromptSection returns empty string when raw system/value are missing', () => {
  const result = buildShoeSizingPromptSection({
    category: 'sneakers',
    brand: 'Nike',
    gender: 'womens',
    measurements: { item_length_in: 10 },
  })
  assert.equal(result, '')
})

test('buildShoeSizingPromptSection renders the EU/UK/US table with no note when no brand override exists', () => {
  const result = buildShoeSizingPromptSection({
    category: 'sneakers',
    brand: 'Nike',
    gender: 'womens',
    measurements: { shoe_size_system: 'eu', shoe_size_raw: '39' },
  })
  assert.equal(result, '\n- Sizing: EU 39 · UK 6 · US 8')
})

test('buildShoeSizingPromptSection includes a Sizing note line when a brand override note is present', () => {
  const fakeBrand = 'test-brand-with-override'
  SHOE_BRAND_OVERRIDES[fakeBrand] = {
    conversions: { mens: [], womens: [{ eu: 39, us: 99 }] },
    note: 'runs half a size small',
  }
  try {
    const result = buildShoeSizingPromptSection({
      category: 'sneakers',
      brand: fakeBrand,
      gender: 'womens',
      measurements: { shoe_size_system: 'eu', shoe_size_raw: '39' },
    })
    assert.equal(result, '\n- Sizing: EU 39 · UK 6 · US 99\n- Sizing note: runs half a size small')
  } finally {
    delete SHOE_BRAND_OVERRIDES[fakeBrand]
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: FAIL — `buildShoeSizingPromptSection is not a function` / import error.

- [ ] **Step 3: Implement `buildShoeSizingPromptSection`**

Append to `src/lib/sizing/shoe-conversion.ts`, after `deriveShoeUsSizeForStorage`:

```ts
// Builds step4a's sizing-table prompt input. Deliberately mirrors deriveShoeUsSizeForStorage's
// guard order (same shape, different failure mode: '' instead of null) since both are answering
// "is there enough raw data here to say anything about shoe size at all". Numbers only ever come
// from convertShoeSize -- the LLM's job downstream is formatting/prose, never inventing sizes.
export function buildShoeSizingPromptSection(args: {
  category: string
  brand: string
  gender: string | null
  measurements: Record<string, unknown> | null
}): string {
  if (args.category !== 'sneakers' || !args.measurements) return ''
  const m = args.measurements
  const rawSystem = typeof m.shoe_size_system === 'string' ? m.shoe_size_system.toLowerCase() : null
  if (rawSystem !== 'us' && rawSystem !== 'eu' && rawSystem !== 'uk') return ''
  const rawValue = typeof m.shoe_size_raw === 'string' ? Number.parseFloat(m.shoe_size_raw) : null
  if (rawValue === null || Number.isNaN(rawValue)) return ''
  if (args.gender !== 'mens' && args.gender !== 'womens') return ''
  const converted = convertShoeSize({ brand: args.brand, system: rawSystem, value: rawValue, gender: args.gender })
  const table = `EU ${converted.euSize} · UK ${converted.ukSize} · US ${converted.usSize}`
  return converted.note ? `\n- Sizing: ${table}\n- Sizing note: ${converted.note}` : `\n- Sizing: ${table}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/shoe-conversion.test.ts`
Expected: PASS — all tests in the file green (17 from Tasks 1-2 + 4 new = 21 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sizing/shoe-conversion.ts src/lib/sizing/shoe-conversion.test.ts
git commit -m "feat(sizing): add buildShoeSizingPromptSection for step4a's sizing-table prompt input"
```

---

## Task 5: Wire the sizing section into `step4a`'s prompt

**Files:**
- Modify: `src/lib/pipeline/step4a-draft-listing.ts:1-8` (import), `:58-69` (measurements query + line), `:100-108` (prompt template), `:130-131` (rules)

- [ ] **Step 1: Add the import**

In `src/lib/pipeline/step4a-draft-listing.ts`, add to the existing import block (after the `formatMeasurementValue` import on line 6):

```ts
import { buildShoeSizingPromptSection } from '@/lib/sizing/shoe-conversion'
```

- [ ] **Step 2: Select `gender` alongside the existing columns**

Change (line 60):

```ts
    .select('measurements, sub_type')
```

to:

```ts
    .select('measurements, sub_type, gender')
```

- [ ] **Step 3: Build the sizing section and exclude its raw keys from the generic measurements line**

The current block (lines 64-76) reads:

```ts
  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    step2.notableFeatures
  )
  const populatedMeasurements = measurementsRow?.measurements
    ? measurementFields.filter((field) => {
        const value = (measurementsRow.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine = populatedMeasurements.length > 0
    ? `\n- Measurements: ${populatedMeasurements
        .map((field) => `${field.label}: ${formatMeasurementValue(field, (measurementsRow!.measurements as Record<string, unknown>)[field.key])}`)
        .join(', ')}`
    : ''
```

Replace it with:

```ts
  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    step2.notableFeatures
  )
  const sizingSection = buildShoeSizingPromptSection({
    category: step2.category,
    brand: step2.brand,
    gender: (measurementsRow?.gender ?? null) as string | null,
    measurements: (measurementsRow?.measurements as Record<string, unknown> | null) ?? null,
  })
  // When the sizing table above already covers these, drop them from the flat measurements
  // line -- otherwise the raw "EU 39" and the formatted "EU 39 · UK 6 · US 8" both show up.
  const shoeSizingKeys = new Set(['shoe_size_system', 'shoe_size_raw', 'us_size'])
  const populatedMeasurements = measurementsRow?.measurements
    ? measurementFields.filter((field) => {
        if (sizingSection && shoeSizingKeys.has(field.key)) return false
        const value = (measurementsRow.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine = populatedMeasurements.length > 0
    ? `\n- Measurements: ${populatedMeasurements
        .map((field) => `${field.label}: ${formatMeasurementValue(field, (measurementsRow!.measurements as Record<string, unknown>)[field.key])}`)
        .join(', ')}`
    : ''
```

- [ ] **Step 4: Append the sizing section to the prompt's item-details block**

The current prompt template (around lines 100-108) reads:

```ts
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}${measurementsLine}

Comparable sold prices:
```

Change the interpolation to also append `sizingSection`:

```ts
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}${measurementsLine}${sizingSection}

Comparable sold prices:
```

- [ ] **Step 5: Add a formatting rule for the LLM**

In the `Rules:` list (around line 130), add a new bullet after the existing "eBay item specifics" line:

```ts
- If a Sizing line is present, present it as a compact size comparison in the description (e.g. "Sizing: EU 39 · UK 6 · US 8.5") and, if a Sizing note is present, weave it into the description as a natural sentence — never invent, alter, or omit these numbers.
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures (no test file targets `step4a-draft-listing.ts` directly today — it's an LLM-calling pipeline step, consistent with the rest of that directory — but nothing here should regress the 21 sizing tests or the 51-test baseline from before this plan).

- [ ] **Step 8: Commit**

```bash
git add src/lib/pipeline/step4a-draft-listing.ts
git commit -m "feat(pipeline): wire shoe sizing table into step4a's listing-generation prompt"
```

---

## Task 6: Final full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — 72 tests (51 baseline + 21 new in `shoe-conversion.test.ts`), 0 failures.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Report status**

No commit needed (nothing changes in this task) — report the final test count and confirm the branch (`feat/shoe-sizing-table`) is ready for `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- "No sizing-table mechanism exists" gap → Tasks 1, 4, 5 (full EU/UK/US row + prompt section + prompt wiring). Covered.
- "Requires passing the full conversion row ... and the matched brand-table note field into step4a's prompt" → Task 4's `buildShoeSizingPromptSection` passes both; Task 5 wires it in. Covered.
- "LLM's role here is formatting/prose only, not deciding the numbers" → Task 5 Step 5's rule bullet states this explicitly; the numbers themselves come only from `convertShoeSize`, never LLM-generated. Covered.
- Jewelry sub-type gap → already fixed prior to this plan (verified directly against `step4a-draft-listing.ts:60,64-67` before writing this plan); no task needed.
- Brand-quirk note sourcing → explicitly out of scope per Joe's decision (see header note); `SHOE_BRAND_OVERRIDES` stays empty, but the `note` plumbing (Task 1's return field, Task 4's conditional line) is fully wired so it activates the moment real data is seeded — no future code change required.

**Placeholder scan:** No TBD/TODO markers; every step has complete code, exact file paths, and exact commands with expected output.

**Type consistency:** `convertShoeSize`'s return type (`{ usSize, euSize, ukSize, source, note? }`) defined in Task 1 is used identically in Task 2 (`converted.usSize`), Task 4 (`converted.euSize`, `converted.ukSize`, `converted.usSize`, `converted.note`) — no naming drift. `deriveShoeUsSizeForStorage` and `buildShoeSizingPromptSection` share the same argument shape (`category`, `gender`, `brand`, `measurements`) by design, verified consistent across Tasks 2, 3, 4, 5.
