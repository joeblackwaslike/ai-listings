# Data-Integrity & Measurements Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five independent, file-disjoint gaps from `docs/superpowers/specs/2026-08-17-data-integrity-measurements-batch-design.md`: a lost-update race in the measurements PATCH route (`ai-listings-0en`), a numeric-only input on a field that needs free text (`ai-listings-5iy`), a missing range guard on a ring-size conversion (`ai-listings-b27`), missing shipping-box estimation for text-intake listings (`ai-listings-0wd`), and a missing live chat echo when measurements are submitted (`ai-listings-9ch`).

**Architecture:** Each task stands alone — no two touch the same file, and none depends on another's code landing first. `ai-listings-0en` introduces the repo's second Postgres RPC (`generate_sku` is the first) and extracts a small pure function (`estimatedShippingBoxFromMeasuredBox`) so the derived-field recompute stays testable in TypeScript rather than duplicated into `plpgsql`. `ai-listings-0wd` replicates an already-working block (`intake-pipeline.ts`'s gender_gate flow) into `text-intake-pipeline.ts`, plus widens one shared helper (`notableFeaturesOf`) both pipelines' gate flow depends on. The other three are small, contained fixes to existing files.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` (`node --import tsx --test`, matches every existing `*.test.ts` in this repo), Next.js 16 API routes, Supabase (self-hosted Postgres, plpgsql RPC), Inngest step functions, React (`AgentChat.tsx`).

**Note on scope:** Three of these tasks (`0en`'s route/pipeline wiring, `0wd`'s Inngest pipeline block, `9ch`'s React component) touch code with no existing automated test harness in this repo (no API-route tests, no Inngest-function tests, no `.tsx` tests exist anywhere in `src/`) — this plan follows the repo's actual convention of unit-testing only the pure-function layer and verifying the rest manually (Task 6), rather than inventing new test infrastructure mid-batch.

---

## Task 1: Add a plausible-range guard to `ringDiameterMmToUsSize`

**Files:**
- Modify: `src/lib/sizing/ring-size.ts:9-12`
- Test: `src/lib/sizing/ring-size.test.ts`

`ringDiameterMmToUsSize` currently has zero runtime guards — a typo'd input (e.g. `180` instead of `18.0`) silently produces a nonsense US ring size with no error. This function has no production callers today (only its own test file references it), so this is forward-compatible hardening, not a behavior change to any live path.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/sizing/ring-size.test.ts` (after the existing last test, which ends at line 15):

```ts
test('ringDiameterMmToUsSize: throws when diameter is below the plausible floor (~12mm)', () => {
  assert.throws(() => ringDiameterMmToUsSize(11.9), /implausible ring diameter/i)
})

test('ringDiameterMmToUsSize: throws when diameter is above the plausible ceiling (~24mm)', () => {
  assert.throws(() => ringDiameterMmToUsSize(24.1), /implausible ring diameter/i)
})

test('ringDiameterMmToUsSize: accepts a diameter just inside the floor boundary (12mm)', () => {
  assert.doesNotThrow(() => ringDiameterMmToUsSize(12))
})

test('ringDiameterMmToUsSize: accepts a diameter just inside the ceiling boundary (24mm)', () => {
  assert.doesNotThrow(() => ringDiameterMmToUsSize(24))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/ring-size.test.ts`
Expected: 2 FAIL ("Missing expected exception" for the two `assert.throws` cases — the function doesn't guard yet), 2 PASS (the boundary cases already pass since there's no guard to reject them).

- [ ] **Step 3: Implement the guard**

Replace `src/lib/sizing/ring-size.ts:9-12` (the function body; the comment block on lines 1-8 stays unchanged):

```ts
export function ringDiameterMmToUsSize(diameterMm: number): number {
  if (diameterMm < 12 || diameterMm > 24) {
    throw new Error(`Implausible ring diameter: ${diameterMm}mm (expected roughly 12-24mm)`)
  }
  const circumferenceMm = Math.PI * diameterMm
  return (circumferenceMm - 36.5) / 2.55
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/ring-size.test.ts`
Expected: 7 tests, 7 pass (3 existing + 4 new).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (one pre-existing unrelated error in `oauth-backend.ts` is expected).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sizing/ring-size.ts src/lib/sizing/ring-size.test.ts
git commit -m "fix(sizing): add plausible-range guard to ringDiameterMmToUsSize

ai-listings-b27"
```

---

## Task 2: Render `ring_inscribed_size` as free text, not a numeric input

**Files:**
- Modify: `src/types/listings.ts:185-191`
- Modify: `src/lib/utils.ts:57-61`
- Modify: `src/components/workspace/MeasurementFields.tsx:27-44,71-82`
- Test: `src/lib/utils.test.ts`

`ring_inscribed_size` renders through `MeasurementFields.tsx`'s `<input type="number">` branch like every other measurement field, but inscribed ring sizes aren't always numeric (e.g. `"6 1/4"`, worn/illegible stamps) — the submit-side `parseFloat`/`isNaN` gate silently truncates or drops that data. This task adds a `textInput?: true` flag to `MeasurementField` (mirroring the existing `useChips?: true`), sets it only on this one field's config, and gives it its own render + submit-parse branch.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/utils.test.ts` (after the existing last test, which ends at line 89):

```ts
test('getMeasurementFields: ring_inscribed_size field is configured as free text, not numeric', () => {
  const fields = getMeasurementFields('jewelry', 'ring', [])
  const inscribedField = fields.find((f) => f.key === 'ring_inscribed_size')
  assert.equal(inscribedField?.textInput, true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/utils.test.ts`
Expected: FAIL — `inscribedField?.textInput` is `undefined` (the field config has no `textInput` key yet), assertion expects `true`.

- [ ] **Step 3: Add the `textInput` flag to `MeasurementField` and set it on the ring-inscribed-size config**

In `src/types/listings.ts`, replace lines 185-191:

```ts
export interface MeasurementField {
  key: keyof Measurements;
  label: string;
  hint: string;
  textInput?: true;
  useChips?: true;
  chipOptions?: string[];
}
```

In `src/lib/utils.ts`, replace lines 57-61 (the `ringInscribedSizeField` object literal):

```ts
    const ringInscribedSizeField: import('@/types/listings').MeasurementField = {
      key: 'ring_inscribed_size',
      label: 'Inscribed Size (if stamped inside the band)',
      hint: 'worth checking with a magnifying glass — often present on precious-metal pieces, not universally reliable',
      textInput: true,
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/utils.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Update `MeasurementFields.tsx`'s render branch and submit parse gate**

No automated test exists for this file (no `.tsx` test exists anywhere in this repo) — verified manually in Task 6.

Replace `handleSubmit()`, `src/components/workspace/MeasurementFields.tsx:27-44`:

```ts
  function handleSubmit() {
    const result: Partial<Measurements> = {}
    for (const field of fields) {
      const raw = values[field.key]
      if (raw === undefined || raw === '') continue
      if (field.useChips) {
        // chip value is stored as lowercase string matching Measurements type
        ;(result as Record<string, unknown>)[field.key] = String(raw).toLowerCase()
      } else if (field.textInput) {
        (result as Record<string, unknown>)[field.key] = String(raw)
      } else {
        const n = parseFloat(String(raw))
        if (!isNaN(n) && n >= 0) {
          (result as Record<string, unknown>)[field.key] =
            inputUnit === 'metric' && isPhysicalLengthField(field.key) ? mmToInches(n) : n
        }
      }
    }
    onSubmit(result)
  }
```

Replace the render branch, `src/components/workspace/MeasurementFields.tsx:71-82`:

```tsx
          {field.useChips && field.chipOptions ? (
            <div className="flex gap-1.5 flex-wrap">
              {field.chipOptions.map((opt) => {
                const selected = String(values[field.key] ?? '').toLowerCase() === opt.toLowerCase()
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setField(field.key, opt)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      selected
                        ? 'border-emerald-500 text-emerald-300 bg-emerald-950'
                        : 'border-gray-700 text-gray-400 hover:border-emerald-500 hover:text-emerald-300'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          ) : field.textInput ? (
            <input
              id={`measurement-${field.key}`}
              type="text"
              placeholder={field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-40 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          ) : (
            <input
              id={`measurement-${field.key}`}
              type="number"
              min={0}
              step={inputUnit === 'metric' && isPhysicalLengthField(field.key) ? '1' : '0.5'}
              placeholder={inputUnit === 'metric' && isPhysicalLengthField(field.key) ? 'in mm' : field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-28 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          )}
```

(The text-input variant is wider — `w-40` vs `w-28` — since stamped sizes like `"6 1/4"` need more horizontal room than a two-digit number.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/listings.ts src/lib/utils.ts src/lib/utils.test.ts src/components/workspace/MeasurementFields.tsx
git commit -m "fix(measurements): render ring_inscribed_size as free text, not numeric

ai-listings-5iy"
```

---

## Task 3: Atomic JSONB merge RPC for the measurements PATCH route

**Files:**
- Modify: `src/lib/sizing/shipping-box.ts`
- Modify: `src/lib/sizing/shipping-box.test.ts`
- Create: `supabase/migrations/0018_measurements_merge_rpc.sql`
- Modify: `src/app/api/listings/[id]/measurements/route.ts`

`PATCH /api/listings/[id]/measurements` currently reads `measurements`, merges the patch in application code, and writes the whole object back — two concurrent PATCHes for the same listing (e.g. `FinalizingChecklist.tsx`'s independent box-dims and weight saves) can race and silently clobber each other. This task replaces that with a Postgres-side atomic JSONB merge RPC, following the repo's only other RPC precedent (`generate_sku`, `supabase/migrations/0001_initial_schema.sql:14-31`).

- [ ] **Step 1: Write the failing tests for the box-dims recompute helper**

Add `estimatedShippingBoxFromMeasuredBox` to the import line at the top of `src/lib/sizing/shipping-box.test.ts` (currently `import { computeEstimatedShippingBox, SHIPPING_BOX_PADDING_IN } from './shipping-box'`):

```ts
import { computeEstimatedShippingBox, estimatedShippingBoxFromMeasuredBox, SHIPPING_BOX_PADDING_IN } from './shipping-box'
```

Append to `src/lib/sizing/shipping-box.test.ts` (after the existing last test, which ends at line 68):

```ts
test('estimatedShippingBoxFromMeasuredBox: returns the box dims verbatim when all three are present', () => {
  const box = estimatedShippingBoxFromMeasuredBox({ box_length_in: 12, box_width_in: 8, box_height_in: 4 })
  assert.deepEqual(box, { length: 12, width: 8, height: 4 })
})

test('estimatedShippingBoxFromMeasuredBox: returns null when box_length_in is missing', () => {
  assert.equal(estimatedShippingBoxFromMeasuredBox({ box_width_in: 8, box_height_in: 4 }), null)
})

test('estimatedShippingBoxFromMeasuredBox: returns null when box_width_in is missing', () => {
  assert.equal(estimatedShippingBoxFromMeasuredBox({ box_length_in: 12, box_height_in: 4 }), null)
})

test('estimatedShippingBoxFromMeasuredBox: returns null when box_height_in is missing', () => {
  assert.equal(estimatedShippingBoxFromMeasuredBox({ box_length_in: 12, box_width_in: 8 }), null)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/sizing/shipping-box.test.ts`
Expected: FAIL — `estimatedShippingBoxFromMeasuredBox` is not exported from `./shipping-box` yet (`TypeError: estimatedShippingBoxFromMeasuredBox is not a function`).

- [ ] **Step 3: Implement `estimatedShippingBoxFromMeasuredBox`**

Append to `src/lib/sizing/shipping-box.ts` (after `computeEstimatedShippingBox`, which currently ends at line 48):

```ts

// The real-box override for the finalizing-checklist flow (PATCH /api/listings/[id]/measurements)
// -- distinct from computeEstimatedShippingBox, which pads an *estimate* from item dims. This one
// just reshapes the three directly-measured box_*_in fields once all three are present; no
// padding, no category branching.
export function estimatedShippingBoxFromMeasuredBox(measurements: Measurements): ShippingBoxDims | null {
  const { box_length_in, box_width_in, box_height_in } = measurements
  if (box_length_in == null || box_width_in == null || box_height_in == null) return null
  return { length: box_length_in, width: box_width_in, height: box_height_in }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/sizing/shipping-box.test.ts`
Expected: 11 tests, 11 pass (7 existing + 4 new).

- [ ] **Step 5: Create the migration**

Create `supabase/migrations/0018_measurements_merge_rpc.sql`:

```sql
-- Atomic JSONB merge for listings.measurements, replacing the read-in-app-code/merge/write
-- pattern in PATCH /api/listings/[id]/measurements, which could silently lose a concurrent
-- PATCH's fields (lost-update race -- ai-listings-0en). The merge happens inside the UPDATE's
-- SET clause so it always applies against the current on-disk value, not a value read moments
-- earlier by the caller; concurrent calls for the same listing serialize on Postgres's normal
-- row lock instead of racing in application code.
--
-- Ownership is enforced in the same statement (WHERE id = ... AND user_id = ...) rather than
-- via a separate SELECT beforehand, so a mismatched/missing owner naturally returns zero rows --
-- surfaced to the caller as NULL rather than a partial read exposing whether the row exists.
create or replace function merge_listing_measurements(
  p_listing_id uuid,
  p_user_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_measurements jsonb;
begin
  update listings
    set measurements = coalesce(measurements, '{}'::jsonb) || p_patch
    where id = p_listing_id
      and user_id = p_user_id
    returning measurements into v_measurements;

  if not found then
    return null;
  end if;

  return v_measurements;
end;
$$;
```

- [ ] **Step 6: Apply the migration**

Run (never `supabase db push` — this repo is self-hosted in k8s, forbidden by `AGENTS.md`):
```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0018_measurements_merge_rpc.sql
```
Expected: `CREATE FUNCTION`

- [ ] **Step 7: Rewrite the route to use the RPC**

Replace `src/app/api/listings/[id]/measurements/route.ts` in full:

```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { estimatedShippingBoxFromMeasuredBox } from '@/lib/sizing/shipping-box'
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
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return Response.json({ error: `${key} must be a positive number` }, { status: 400 })
    }
    patch[key] = value
  }

  const supabase = getSupabaseAdmin()

  // Atomic JSONB merge (ai-listings-0en) -- replaces the prior read-then-merge-then-write
  // pattern, which could silently lose a concurrent PATCH's fields (e.g. the box-dims save
  // and the weight save from the finalizing checklist UI racing each other). Ownership is
  // enforced inside the RPC's WHERE clause, so a mismatched/missing owner returns NULL.
  const { data: merged, error } = await supabase.rpc('merge_listing_measurements', {
    p_listing_id: id,
    p_user_id: user.id,
    p_patch: patch,
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (merged === null) return Response.json({ error: 'Not found' }, { status: 404 })

  let measurements = merged as Measurements

  // Known-value-first: a real measured box overrides the padded estimate once all three
  // dimensions are known -- see Feature 3's "Estimated shipping box" in the spec. This is a
  // second, non-atomic RPC call, but only for the derived estimated_shipping_box field, not
  // the user-authored patch above -- a residual race here self-heals on the next box-dims PATCH.
  const box = estimatedShippingBoxFromMeasuredBox(measurements)
  if (box) {
    const { data: mergedWithBox, error: boxError } = await supabase.rpc('merge_listing_measurements', {
      p_listing_id: id,
      p_user_id: user.id,
      p_patch: { estimated_shipping_box: box },
    })
    if (boxError) return Response.json({ error: boxError.message }, { status: 500 })
    if (mergedWithBox !== null) measurements = mergedWithBox as Measurements
  }

  return Response.json({ ok: true, measurements })
}
```

No automated test exists for API routes in this repo — verified manually in Task 6 against the real k8s Supabase (two sequential PATCHes on the same listing, non-owner PATCH returns 404).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sizing/shipping-box.ts src/lib/sizing/shipping-box.test.ts supabase/migrations/0018_measurements_merge_rpc.sql src/app/api/listings/\[id\]/measurements/route.ts
git commit -m "fix(measurements): atomic JSONB merge RPC for measurements PATCH

ai-listings-0en"
```

---

## Task 4: Wire shipping-box estimation into the text-intake pipeline

**Files:**
- Modify: `src/lib/pipeline/gate-messages.ts:17-19`
- Modify: `src/lib/pipeline/gate-messages.test.ts`
- Modify: `src/lib/inngest/functions/text-intake-pipeline.ts`

Text-intake listings (`/api/intake-text`) never run a gender_gate-equivalent measurement-collection step and never get an `estimated_shipping_box`, unlike photo-intake listings — `text-intake-pipeline.ts` goes straight from text analysis through pricing/drafting to `in_loop`. This task ports `intake-pipeline.ts`'s existing gender_gate block over verbatim, and widens the one shared helper (`notableFeaturesOf`) that both pipelines' gate flow depends on, since text-intake writes its notable features under a different `intake_meta` key (`textAnalysis` instead of `visionAnalysis`).

- [ ] **Step 1: Write the failing tests for `notableFeaturesOf`**

Add `notableFeaturesOf` to the import list at the top of `src/lib/pipeline/gate-messages.test.ts` (currently lines 3-12, ending `synthesizeIdGateAnswer,`):

```ts
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  notableFeaturesOf,
  shouldPersistInLoopGreeting,
  synthesizeGenderGateAnswer,
  synthesizeIdGateAnswer,
} from './gate-messages'
```

Append to `src/lib/pipeline/gate-messages.test.ts` (after the existing last test, which ends at line 248):

```ts

test('notableFeaturesOf reads notable_features from visionAnalysis when present', () => {
  const features = notableFeaturesOf({ visionAnalysis: { notable_features: ['Model: Submariner'] } })
  assert.deepEqual(features, ['Model: Submariner'])
})

test('notableFeaturesOf falls back to textAnalysis when visionAnalysis is absent', () => {
  const features = notableFeaturesOf({ textAnalysis: { notable_features: ['Model: Solitaire Ring'] }, source: 'text' })
  assert.deepEqual(features, ['Model: Solitaire Ring'])
})

test('notableFeaturesOf returns an empty array when intake_meta is null', () => {
  assert.deepEqual(notableFeaturesOf(null), [])
})

test('notableFeaturesOf returns an empty array when neither visionAnalysis nor textAnalysis is present', () => {
  assert.deepEqual(notableFeaturesOf({}), [])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: the `textAnalysis` fallback test FAILs (`notableFeaturesOf` only reads `visionAnalysis` today, so it returns `[]` instead of `['Model: Solitaire Ring']`); the other three pass already (they're consistent with today's behavior).

- [ ] **Step 3: Widen `notableFeaturesOf`**

Replace `src/lib/pipeline/gate-messages.ts:17-19`:

```ts
export function notableFeaturesOf(intakeMeta: Record<string, unknown> | null): string[] {
  const source = intakeMeta?.visionAnalysis ?? intakeMeta?.textAnalysis
  return (source as { notable_features?: string[] } | undefined)?.notable_features ?? []
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: all tests in the file pass (25 existing + 4 new = 29).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit the shared-helper change**

```bash
git add src/lib/pipeline/gate-messages.ts src/lib/pipeline/gate-messages.test.ts
git commit -m "fix(pipeline): notableFeaturesOf also reads intake_meta.textAnalysis

ai-listings-0wd"
```

- [ ] **Step 7: Wire the gender_gate block into the text-intake pipeline**

No automated test exists for Inngest step functions in this repo (`intake-pipeline.ts` itself has no test file) — verified manually in Task 6.

Replace the import block at the top of `src/lib/inngest/functions/text-intake-pipeline.ts` (lines 1-10):

```ts
import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { TextSubmittedEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin, pushPipelineStep } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'
import { detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { classifyJewelrySubTypeWithLlm } from '@/lib/jewelry-llm-fallback'
import { computeEstimatedShippingBox } from '@/lib/sizing/shipping-box'
import { deriveShoeUsSizeForStorage } from '@/lib/sizing/shoe-conversion'
import type { VisionAnalysis } from '@/lib/pipeline/step2-vision-analysis'
import type { ClothingSubType, ConditionValue, JewelrySubType, ListingCategory, Measurements } from '@/types/listings'
```

Replace the function body (`src/lib/inngest/functions/text-intake-pipeline.ts:208-264`, the `async ({ event, step }) => { ... }` handler):

```ts
  async ({ event, step }) => {
    const { listingId, productData } = (event as unknown as TextSubmittedEvent).data
    const { description, brand, imageUrl } = productData

    const supabase = getSupabaseAdmin()

    const apiKeys = await step.run('fetch-api-keys', async () => {
      const { data: listingRow } = await supabase
        .from('listings')
        .select('user_id')
        .eq('id', listingId)
        .single()
      return getUserApiKeys(listingRow?.user_id ?? null)
    })

    // Step 2: text analysis
    const step2Result = await step.run('text-analysis', () =>
      runTextAnalysis(listingId, description, brand, apiKeys)
    )

    const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])
    const needsGender = GENDER_CATEGORIES.has(step2Result.category?.toLowerCase() ?? '')

    let gender: string | null = null
    let measurements: Record<string, unknown> | null = null

    // Same gender/measurements/shipping-box gate as the photo-intake pipeline
    // (intake-pipeline.ts) -- ai-listings-0wd. Text-intake listings previously had no path
    // to collect item dimensions or get an estimated shipping box.
    await step.run('gender-gate-start', () =>
      supabase.from('listings').update({ status: 'gender_gate' }).eq('id', listingId).neq('status', 'archived')
    )

    const genderConfirmation = await step.waitForEvent('gender-gate-confirm', {
      event: 'pipeline/gender-confirmed',
      timeout: '7d',
      match: 'data.listingId',
    })

    if (genderConfirmation) {
      const gd = (genderConfirmation as unknown as {
        data: { gender?: string; measurements?: Record<string, unknown> | null }
      }).data
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
      const measurementsWithShippingBox = estimatedShippingBox
        ? { ...measurements, estimated_shipping_box: estimatedShippingBox }
        : measurements

      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements: measurementsWithShippingBox, sub_type: subType }).eq('id', listingId)
      )

      if (subType === null && category === 'jewelry') {
        await step.run('jewelry-subtype-llm-fallback', async () => {
          // Best-effort, deliberately non-fatal -- same rationale as intake-pipeline.ts's
          // identical fallback.
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

    const titleForComps = (step2Result.notableFeatures[0] ?? '').replace(/^Model:\s*/i, '').trim()

    // Step 3: pricing research
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps, apiKeys, gender)
    )

    const { data: listingAfterStep3 } = await supabase
      .from('listings')
      .select('suggested_price_cents')
      .eq('id', listingId)
      .single()
    const suggestedPriceCents: number | null =
      listingAfterStep3?.suggested_price_cents ?? null

    // Step 4a: draft listing
    await step.run('draft-listing', () =>
      runStep4aDraftListing(listingId, step2Result, suggestedPriceCents, apiKeys)
    )

    // Step 5: auth plan (luxury only)
    if (step2Result.isLuxury) {
      await step.run('auth-plan', () =>
        runStep5AuthPlan(listingId, step2Result, suggestedPriceCents, apiKeys)
      )
    }

    await pushPipelineStep(listingId, {
      status: 'in_loop',
      pipeline_total: 4,
      agent_blocked: false,
      agent_blocked_reason: null,
    })

    return { ok: true, listingId, status: 'in_loop' }
  }
```

Two structural changes from the original: `supabase` is now declared once at the top of the handler (matching `intake-pipeline.ts:67`) instead of being created separately inside the `fetch-api-keys` closure and again after step 3 — both of those redundant declarations are removed since the hoisted one is reused. `runStep3PricingResearch`'s call now passes `gender` as its 5th argument (previously omitted, despite the function's signature already accepting `gender?: string | null`).

On `waitForEvent` timeout (7 days, unconfirmed), `genderConfirmation` is `null`, so the entire `if (genderConfirmation)` block is skipped and the pipeline falls through to pricing research with `gender: null` — identical to `intake-pipeline.ts`'s existing behavior, no new timeout-specific logic introduced.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/inngest/functions/text-intake-pipeline.ts
git commit -m "feat(pipeline): wire shipping-box estimation into text-intake pipeline

ai-listings-0wd"
```

---

## Task 5: Echo submitted measurements into the chat before pricing research

**Files:**
- Modify: `src/components/workspace/AgentChat.tsx:1-9,155-166`

`AgentChat.tsx`'s `handleMeasurementsSubmit` pushes only an assistant acknowledgment bubble on submit — the `MeasurementFields` form just disappears with no record of what was entered, unlike the sibling `confirmGender` handler (lines 239-257), which already pushes a local `user`-role echo before its own API call.

- [ ] **Step 1: Add the `formatMeasurementValue` import**

In `src/components/workspace/AgentChat.tsx`, add to the import block (after line 8, `import { MeasurementFields } from './MeasurementFields'`):

```ts
import { formatMeasurementValue } from '@/lib/units'
```

- [ ] **Step 2: Push a local echo before the assistant acknowledgment**

Replace `handleMeasurementsSubmit`, `src/components/workspace/AgentChat.tsx:155-166`:

```ts
  async function handleMeasurementsSubmit(measurements: Partial<Measurements>) {
    genderGateResolvedRef.current = true
    setShowMeasurements(false)
    setSuggestionsDismissed(true)

    const parts = (detailGateContext?.measurementFields ?? [])
      .filter((f) => measurements[f.key] !== undefined)
      .map((f) => `${f.label}: ${formatMeasurementValue(f, measurements[f.key])}`)
    const genderPart = pendingGender ? `Gender: ${pendingGender}` : null
    const echoContent = [genderPart, ...parts].filter(Boolean).join(', ')
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: echoContent }])

    setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: "Got it — running pricing research now. The listing will update in a moment." }])
    await fetch('/api/pipeline/confirm-gender', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, gender: pendingGender, measurements }),
    })
    setPendingGender(null)
  }
```

No automated test exists for this file (no `.tsx` test exists anywhere in this repo) — verified manually in Task 6 against a live `gender_gate` listing.

**Out of scope for this task:** a broader audit of other confirm-style actions with the same missing-echo gap (e.g. `suggestion.confirmPhotos` in `handleSuggestionSelect`, `AgentChat.tsx:224-226`, which has no echo of any kind and no `return`) — noted per the spec as a candidate for future work, not fixed here.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/AgentChat.tsx
git commit -m "feat(chat): echo submitted measurements into the chat before pricing research

ai-listings-9ch"
```

---

## Task 6: Final full-suite verification

**Files:** none (verification only)

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: 155 tests, 155 pass (142 baseline + 4 ring-size + 1 utils + 4 shipping-box + 4 gate-messages), 0 fail.
**Result:** 155/155 pass, confirmed independently by the final holistic reviewer as well as each task's own verification.

- [x] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: only the one pre-existing, unrelated error in `oauth-backend.ts`; no new errors.
**Result:** clean, exit 0 — the anticipated pre-existing `oauth-backend.ts` error no longer reproduces (unrelated to this batch; a net improvement, not a regression this batch caused).

- [x] **Step 3: Lint the whole project**

Run: `npx eslint .`
Expected: no errors introduced by this batch.
**Result:** 1 error + 55 warnings, all confirmed pre-existing and in files this batch never touched (verified against `origin/main`) — the one warning inside a touched file (`text-intake-pipeline.ts:215`, unused `imageUrl`) is on a line the diff didn't modify.

- [x] **Step 4: Manual smoke — `ai-listings-0en` (two-PATCH no-clobber)**

Performed during Task 3's implementation and independently re-verified during its code-quality review: functional checks run directly against real production rows via `kubectl exec ... psql`, wrapped in `BEGIN; ... ROLLBACK;` (no data mutated) — correct-owner merge onto a row with existing measurements (old keys preserved, new key added), merge onto `measurements = NULL` (coalesce path), and a wrong-owner call (confirmed returns no row / NULL). The live RPC's `pg_get_functiondef` output was diffed against the migration file and matches verbatim; `prosecdef = f` confirmed (not security-definer, so RLS's `owner_access` policy is the real backstop, as designed).
**Not performed:** an actual two-sequential-PATCH-over-HTTP run against a live session cookie (the curl commands as originally written) — this requires a real browser-authenticated session, which was not available in this session (see Steps 5-7 below). The rollback-wrapped SQL-level verification above exercises the same atomic-merge code path the route calls, so it's strong evidence, but it doesn't exercise the Next.js route handler itself end-to-end.

- [ ] **Step 5: Manual smoke — `ai-listings-0wd` (text-intake gender_gate parity)** — **NOT COMPLETED, needs Joe**

Attempted via browser automation against `http://localhost:3000` with a real `gender_gate` listing already in the database. Blocked: no Supabase login session available to this session. The app's `x-agent-token`/`AGENT_BYPASS_TOKEN` proxy bypass (`src/proxy.ts:56-57`) was tried and confirmed to only skip the middleware's redirect-to-login — it does not (and by design should not) bypass `auth.getUser()`/RLS inside the actual page/route, so the listing page correctly 404s with no real session. This is the same class of gap already tracked for `ai-listings-kni`. Needs a live click-through by Joe (or a real session cookie handed to the agent) to actually submit a text-intake listing, watch it reach `gender_gate`, resolve it, and confirm `estimated_shipping_box` lands in `measurements`.

- [ ] **Step 6: Manual smoke — `ai-listings-9ch` (chat echo)** — **NOT COMPLETED, needs Joe**

Same blocker as Step 5 — no authenticated session available. Code-level verification (spec compliance + code quality review, both independently reading the actual diff) confirms the echo logic is correct and ordered properly, and confirmed the previously-flagged "empty echo" edge case does not render visibly due to an existing `{msg.content && ...}` guard — but no live click-through was performed.

- [ ] **Step 7: Manual smoke — `ai-listings-5iy` (ring_inscribed_size text input)** — **NOT COMPLETED, needs Joe**

Same blocker as Step 5. Code-level verification (spec compliance + code quality review) confirms the render branch and submit-parse gate are correct, but no live click-through confirming the actual rendered `<input type="text">` accepts `"6 1/4"` was performed.

---

## Self-Review

**Spec coverage:**
- `ai-listings-0en` (atomic JSONB merge) — Task 3.
- `ai-listings-5iy` (ring_inscribed_size text input) — Task 2.
- `ai-listings-b27` (ring diameter range guard) — Task 1.
- `ai-listings-0wd` (text-intake shipping-box parity, `notableFeaturesOf` widening) — Task 4.
- `ai-listings-9ch` (measurements-submit chat echo) — Task 5.
- Spec's explicitly-out-of-scope items (RPC-side key validation, full SQL-side atomicity, the broader confirm-action echo audit, jewelry-LLM-fallback logic changes) are not implemented anywhere in this plan, consistent with the spec.

**Placeholder scan:** no "TBD"/"TODO" markers; every code step shows complete, exact code; every test/typecheck/commit step names the exact command and expected outcome, including running test counts.

**Type consistency:** `MeasurementField.textInput` (Task 2, `types/listings.ts`) is referenced identically in `utils.ts` (field config) and `MeasurementFields.tsx` (render + submit) — same name, same `true`-literal type. `estimatedShippingBoxFromMeasuredBox` (Task 3, `shipping-box.ts`) has the same signature (`(measurements: Measurements) => ShippingBoxDims | null`) at its definition, its test, and its two call sites in `route.ts`. `notableFeaturesOf` (Task 4, `gate-messages.ts`) keeps its existing signature (`(intakeMeta: Record<string, unknown> | null) => string[]`) — only its internal implementation changes, so none of its other call sites (`FieldsPanel.tsx`, `agent/tools.ts`) need updating. The gender_gate block ported into `text-intake-pipeline.ts` (Task 4) uses `step2Result.category`/`.notableFeatures`/`.brand`/`.isLuxury` — confirmed identical field names to `intake-pipeline.ts`'s usage, since `runTextAnalysis`'s return type is the same `VisionAnalysis` shape.
