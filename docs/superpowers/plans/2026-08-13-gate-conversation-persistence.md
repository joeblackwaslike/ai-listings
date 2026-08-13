# Gate Conversation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the `id_gate`/`gender_gate` prompt→answer→acknowledgment exchanges (and the one-off `in_loop` first greeting) as real rows in the `conversations` table, so `AgentChat`'s scrollback survives status transitions instead of vanishing.

**Architecture:** Extract the gate-prompt text logic from `page.tsx` into a new pure module (`src/lib/pipeline/gate-messages.ts`) shared by the RSC page and the two confirm API routes, so persisted content always matches what was shown on screen. The two API routes (`confirm-id`, `confirm-gender`) insert three `conversations` rows each (assistant prompt → user answer → assistant ack) before sending their existing Inngest events. `page.tsx` gets one additional, self-limiting write for the narrow `in_loop` first-message gap.

**Tech Stack:** Next.js App Router (Server Components + Route Handlers), Supabase (self-hosted, `@supabase/supabase-js` + `@supabase/ssr`), Inngest, TypeScript strict mode, `node --test` + `tsx` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-13-gate-conversation-persistence-design.md`
**Tracking:** bd issue `ai-listings-x9e`

---

### Task 1: `gate-messages.ts` pure functions

**Files:**
- Create: `src/lib/pipeline/gate-messages.ts`
- Test: `src/lib/pipeline/gate-messages.test.ts`

- [x] **Step 1: Write the failing test file**

Create `src/lib/pipeline/gate-messages.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  synthesizeGenderGateAnswer,
  synthesizeIdGateAnswer,
} from './gate-messages'
import type { GenderGateListing, IdGateListing } from './gate-messages'
import type { DetailGateContext } from '@/types/listings'

function idListing(overrides: Partial<IdGateListing> = {}): IdGateListing {
  return {
    brand: 'Rolex',
    category: 'watches',
    condition: 'good',
    condition_notes: null,
    intake_meta: null,
    ...overrides,
  }
}

function genderListing(overrides: Partial<GenderGateListing> = {}): GenderGateListing {
  return {
    category: 'watches',
    intake_meta: null,
    ...overrides,
  }
}

test('buildIdGatePrompt includes brand, category, and condition', () => {
  const prompt = buildIdGatePrompt(idListing())
  assert.match(prompt, /Brand: Rolex/)
  assert.match(prompt, /Category: watches/)
  assert.match(prompt, /Condition: good/)
})

test('buildIdGatePrompt includes notable features when present', () => {
  const prompt = buildIdGatePrompt(idListing({
    intake_meta: { visionAnalysis: { notable_features: ['Model: Submariner', 'Steel bracelet'] } },
  }))
  assert.match(prompt, /• Model: Submariner/)
  assert.match(prompt, /• Steel bracelet/)
})

test('buildIdGatePrompt omits the notable-features section when there are none', () => {
  const prompt = buildIdGatePrompt(idListing())
  assert.doesNotMatch(prompt, /•/)
})

test('buildIdGatePrompt includes condition notes when present', () => {
  const prompt = buildIdGatePrompt(idListing({ condition_notes: 'Small scratch on the clasp' }))
  assert.match(prompt, /Notes: Small scratch on the clasp/)
})

test('buildIdGatePrompt falls back to placeholders when brand/category/condition are missing', () => {
  const prompt = buildIdGatePrompt(idListing({ brand: null, category: null, condition: null }))
  assert.match(prompt, /Brand: Unknown brand/)
  assert.match(prompt, /Category: unknown category/)
  assert.match(prompt, /Condition: unknown condition/)
})

test('buildIdGateSnapshot captures brand/category/condition/notes/features', () => {
  const snapshot = buildIdGateSnapshot(idListing({
    condition_notes: 'Mint',
    intake_meta: { visionAnalysis: { notable_features: ['Model: Submariner'] } },
  }))
  assert.deepEqual(snapshot, {
    brand: 'Rolex',
    category: 'watches',
    condition: 'good',
    condition_notes: 'Mint',
    notable_features: ['Model: Submariner'],
  })
})

test('synthesizeIdGateAnswer returns a confirmed summary when confirmed is true', () => {
  const answer = synthesizeIdGateAnswer({ confirmed: true, corrections: null, listing: idListing() })
  assert.equal(answer, 'Confirmed — Rolex watches, condition: good.')
})

test('synthesizeIdGateAnswer returns the raw corrections text when confirmed is false', () => {
  const answer = synthesizeIdGateAnswer({
    confirmed: false,
    corrections: "That's actually an Omega, not a Rolex",
    listing: idListing(),
  })
  assert.equal(answer, "That's actually an Omega, not a Rolex")
})

test('buildIdGateAck varies by confirmed', () => {
  assert.equal(
    buildIdGateAck({ confirmed: true }),
    'Confirmed! Running pricing research now — the listing will update in a moment.'
  )
  assert.equal(
    buildIdGateAck({ confirmed: false }),
    'Got it — re-running the identification with your correction. The card will update shortly.'
  )
})

test('buildGenderGatePrompt asks for gender and size when the category needs both', () => {
  const { message, detailGateContext } = buildGenderGatePrompt(genderListing({ category: 'clothing' }))
  assert.match(message, /what's the gender and size/)
  assert.equal(detailGateContext.categoryNeedsGender, true)
  assert.equal(detailGateContext.categoryNeedsMeasurements, true)
})

test('buildGenderGatePrompt asks for measurements only when the category needs no gender', () => {
  const { message, detailGateContext } = buildGenderGatePrompt(genderListing({ category: 'handbag' }))
  assert.match(message, /I need a few measurements/)
  assert.equal(detailGateContext.categoryNeedsGender, false)
  assert.equal(detailGateContext.categoryNeedsMeasurements, true)
  assert.deepEqual(detailGateContext.measurementFields.map((f) => f.key), ['height', 'width', 'depth'])
})

test('synthesizeGenderGateAnswer combines gender and measurement lines', () => {
  const detailGateContext: DetailGateContext = {
    category: 'clothing',
    categoryNeedsGender: true,
    clothingSubTypeHint: 'jeans',
    categoryNeedsMeasurements: true,
    measurementFields: [
      { key: 'waist', label: 'Waist', hint: 'in inches' },
      { key: 'inseam', label: 'Inseam', hint: 'in inches' },
    ],
  }
  const answer = synthesizeGenderGateAnswer({
    gender: 'mens',
    measurements: { waist: 32, inseam: 30 },
    detailGateContext,
  })
  assert.equal(answer, "Men's — Waist: 32, Inseam: 30")
})

test('synthesizeGenderGateAnswer handles measurements-only (no gender)', () => {
  const detailGateContext: DetailGateContext = {
    category: 'handbag',
    categoryNeedsGender: false,
    clothingSubTypeHint: null,
    categoryNeedsMeasurements: true,
    measurementFields: [
      { key: 'height', label: 'Height', hint: 'in inches' },
      { key: 'width', label: 'Width', hint: 'in inches' },
      { key: 'depth', label: 'Depth', hint: 'in inches' },
    ],
  }
  const answer = synthesizeGenderGateAnswer({
    gender: null,
    measurements: { height: 10, width: 6, depth: 3 },
    detailGateContext,
  })
  assert.equal(answer, 'Height: 10, Width: 6, Depth: 3')
})

test('buildGenderGateAck returns the fixed acknowledgment', () => {
  assert.equal(
    buildGenderGateAck(),
    'Got it — running pricing research now. The listing will update in a moment.'
  )
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: FAIL — `Cannot find module './gate-messages'` (the file doesn't exist yet).

- [x] **Step 3: Write the implementation**

Create `src/lib/pipeline/gate-messages.ts`:

```ts
import type { DetailGateContext, Listing } from '@/types/listings'
import { detectClothingSubType, getMeasurementFields } from '@/lib/utils'

const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])

const GENDER_LABELS: Record<string, string> = {
  mens: "Men's",
  womens: "Women's",
  unisex: 'Unisex',
}

export type IdGateListing = Pick<Listing, 'brand' | 'category' | 'condition' | 'condition_notes' | 'intake_meta'>
export type GenderGateListing = Pick<Listing, 'category' | 'intake_meta'>

function notableFeaturesOf(intakeMeta: Record<string, unknown> | null): string[] {
  return (intakeMeta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []
}

export function buildIdGatePrompt(listing: IdGateListing): string {
  const brand = listing.brand ?? 'Unknown brand'
  const category = listing.category ?? 'unknown category'
  const condition = (listing.condition ?? 'unknown condition').replace(/_/g, ' ')
  const notes = listing.condition_notes
  const features = notableFeaturesOf(listing.intake_meta)

  return [
    "I've analyzed the photo. Here's what I found:",
    '',
    `Brand: ${brand}`,
    `Category: ${category}`,
    ...(features.length > 0 ? ['', ...features.map((f) => `• ${f}`)] : []),
    '',
    `Condition: ${condition}`,
    notes ? `Notes: ${notes}` : null,
    '',
    "Does this look right? Confirm to continue to pricing research, or describe what's wrong.",
  ].filter((l): l is string => l !== null).join('\n')
}

export function buildIdGateSnapshot(listing: IdGateListing): Record<string, unknown> {
  return {
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    condition_notes: listing.condition_notes,
    notable_features: notableFeaturesOf(listing.intake_meta),
  }
}

export function buildGenderGatePrompt(
  listing: GenderGateListing
): { message: string; detailGateContext: DetailGateContext } {
  const category = listing.category ?? 'item'
  const categoryNeedsGender = GENDER_CATEGORIES.has(category.toLowerCase())
  const notableFeatures = notableFeaturesOf(listing.intake_meta)
  const clothingSubTypeHint = category === 'clothing' ? detectClothingSubType(notableFeatures) : null
  const measurementFields = getMeasurementFields(category, clothingSubTypeHint)
  const categoryNeedsMeasurements = measurementFields.length > 0

  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    clothingSubTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
  }

  if (!categoryNeedsGender) {
    const message = categoryNeedsMeasurements
      ? `Quick question before I run pricing — I need a few measurements for this ${category} to find accurate comps.`
      : `Getting ready to run pricing research for this ${category}.`
    return { message, detailGateContext }
  }

  const message = categoryNeedsMeasurements
    ? `Quick question before I run pricing — what's the gender and size for this ${category}? Pick the gender below, then I'll ask for measurements.`
    : `Quick question before I run pricing — is this ${category} Men's or Women's?`

  return { message, detailGateContext }
}

export function synthesizeIdGateAnswer(args: {
  confirmed: boolean
  corrections: string | null
  listing: IdGateListing
}): string {
  if (!args.confirmed) return args.corrections ?? ''

  const brand = args.listing.brand ?? 'Unknown brand'
  const category = args.listing.category ?? 'unknown category'
  const condition = (args.listing.condition ?? 'unknown condition').replace(/_/g, ' ')
  return `Confirmed — ${brand} ${category}, condition: ${condition}.`
}

export function synthesizeGenderGateAnswer(args: {
  gender: string | null
  measurements: Record<string, unknown> | null
  detailGateContext: DetailGateContext
}): string {
  const parts: string[] = []

  if (args.gender) {
    parts.push(GENDER_LABELS[args.gender] ?? args.gender)
  }

  if (args.measurements) {
    const measurements = args.measurements
    const lines = args.detailGateContext.measurementFields
      .filter((field) => measurements[field.key] !== undefined && measurements[field.key] !== null && measurements[field.key] !== '')
      .map((field) => `${field.label}: ${String(measurements[field.key])}`)
    if (lines.length > 0) parts.push(lines.join(', '))
  }

  return parts.join(' — ')
}

export function buildIdGateAck(args: { confirmed: boolean }): string {
  return args.confirmed
    ? 'Confirmed! Running pricing research now — the listing will update in a moment.'
    : 'Got it — re-running the identification with your correction. The card will update shortly.'
}

export function buildGenderGateAck(): string {
  return 'Got it — running pricing research now. The listing will update in a moment.'
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: PASS — all 15 tests green.

- [x] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/pipeline/gate-messages.ts src/lib/pipeline/gate-messages.test.ts`
Expected: no errors. Fix any that surface (e.g. import ordering) before continuing.

- [x] **Step 6: Commit**

```bash
git add src/lib/pipeline/gate-messages.ts src/lib/pipeline/gate-messages.test.ts
git commit -m "feat(pipeline): add gate-messages pure functions for prompt/answer/ack text"
```

---

### Task 2: Wire `page.tsx` to the shared builders

**Files:**
- Modify: `src/app/listings/[id]/page.tsx`

- [x] **Step 1: Replace the imports**

In `src/app/listings/[id]/page.tsx`, replace:

```ts
import { detectClothingSubType, getMeasurementFields, studioPhotosReady } from '@/lib/utils'

const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])
```

with:

```ts
import { studioPhotosReady } from '@/lib/utils'
import { buildGenderGatePrompt, buildIdGatePrompt, synthesizeIdGateAnswer } from '@/lib/pipeline/gate-messages'
```

(`detectClothingSubType`/`getMeasurementFields`/`GENDER_CATEGORIES` are no longer used directly in this file — that logic now lives in `gate-messages.ts`.)

- [x] **Step 2: Replace `idGateContext` and `genderGateContext`**

Replace the full bodies of both functions:

```ts
function idGateContext(listing: Listing): WorkspaceContext {
  const brand = listing.brand ?? 'Unknown brand'
  const category = listing.category ?? 'unknown category'
  const condition = (listing.condition ?? 'unknown condition').replace(/_/g, ' ')
  const notes = listing.condition_notes
  const features = (listing.intake_meta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []

  const lines = [
    "I've analyzed the photo. Here's what I found:",
    '',
    `Brand: ${brand}`,
    `Category: ${category}`,
    ...(features.length > 0 ? ['', ...features.map((f) => `• ${f}`)] : []),
    '',
    `Condition: ${condition}`,
    notes ? `Notes: ${notes}` : null,
    '',
    "Does this look right? Confirm to continue to pricing research, or describe what's wrong.",
  ].filter((l): l is string => l !== null).join('\n')

  return ctx(lines, [
    {
      label: 'Yes, that\'s correct',
      confirmId: true,
      message: `Confirmed — ${brand} ${category}, condition: ${condition}.`,
    },
    { label: "Something's wrong", focusInput: true },
  ])
}

function genderGateContext(listing: Listing): WorkspaceContext {
  const category = listing.category ?? 'item'
  const categoryNeedsGender = GENDER_CATEGORIES.has(category.toLowerCase())
  const notableFeatures = (listing.intake_meta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []
  const clothingSubTypeHint = category === 'clothing' ? detectClothingSubType(notableFeatures) : null
  const measurementFields = getMeasurementFields(category, clothingSubTypeHint)
  const categoryNeedsMeasurements = measurementFields.length > 0

  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    clothingSubTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
  }

  if (!categoryNeedsGender) {
    const message = categoryNeedsMeasurements
      ? `Quick question before I run pricing — I need a few measurements for this ${category} to find accurate comps.`
      : `Getting ready to run pricing research for this ${category}.`
    return ctx(message, [{ label: 'Enter measurements', focusInput: false }], detailGateContext)
  }

  const message = categoryNeedsMeasurements
    ? `Quick question before I run pricing — what's the gender and size for this ${category}? Pick the gender below, then I'll ask for measurements.`
    : `Quick question before I run pricing — is this ${category} Men's or Women's?`

  return ctx(message, [
    { label: "Men's", confirmGender: 'mens', needsSize: false, message: "Men's" },
    { label: "Women's", confirmGender: 'womens', needsSize: false, message: "Women's" },
    { label: 'Unisex', confirmGender: 'unisex', message: 'Unisex' },
  ], detailGateContext)
}
```

with:

```ts
function idGateContext(listing: Listing): WorkspaceContext {
  return ctx(buildIdGatePrompt(listing), [
    {
      label: 'Yes, that\'s correct',
      confirmId: true,
      message: synthesizeIdGateAnswer({ confirmed: true, corrections: null, listing }),
    },
    { label: "Something's wrong", focusInput: true },
  ])
}

function genderGateContext(listing: Listing): WorkspaceContext {
  const { message, detailGateContext } = buildGenderGatePrompt(listing)

  if (!detailGateContext.categoryNeedsGender) {
    return ctx(message, [{ label: 'Enter measurements', focusInput: false }], detailGateContext)
  }

  return ctx(message, [
    { label: "Men's", confirmGender: 'mens', needsSize: false, message: "Men's" },
    { label: "Women's", confirmGender: 'womens', needsSize: false, message: "Women's" },
    { label: 'Unisex', confirmGender: 'unisex', message: 'Unisex' },
  ], detailGateContext)
}
```

- [x] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `idGateContext`/`genderGateContext` still satisfy `WorkspaceContext`, and no unused imports remain).

Run: `npx eslint src/app/listings/\[id\]/page.tsx`
Expected: no errors.

- [x] **Step 4: Manually verify no visible behavior change**

Run: `npm run dev`, open a listing currently in `id_gate` or `gender_gate` status (or wait for one to reach that state), confirm the chat prompt text renders identically to before this change. This is a pure refactor — text output must be byte-for-byte the same as pre-change.

- [x] **Step 5: Commit**

```bash
git add src/app/listings/\[id\]/page.tsx
git commit -m "refactor(listings): wire idGateContext/genderGateContext to gate-messages builders"
```

---

### Task 3: In-loop first-message persistence (narrow gap closure)

**Files:**
- Modify: `src/app/listings/[id]/page.tsx`

- [x] **Step 1: Add the write**

In `WorkspacePage`, immediately after the block that computes `firstMessage`/`suggestions`/`detailGateContext`, insert a guarded write. Replace:

```ts
  const hasHistory = history.length > 0
  const { firstMessage, suggestions, detailGateContext } = !hasHistory || listing.status === 'id_gate' || listing.status === 'gender_gate'
    ? buildWorkspaceContext(listing, photos, hasHistory)
    : { firstMessage: null, suggestions: null, detailGateContext: undefined }

  return (
```

with:

```ts
  const hasHistory = history.length > 0
  const { firstMessage, suggestions, detailGateContext } = !hasHistory || listing.status === 'id_gate' || listing.status === 'gender_gate'
    ? buildWorkspaceContext(listing, photos, hasHistory)
    : { firstMessage: null, suggestions: null, detailGateContext: undefined }

  if (shouldPersistInLoopGreeting(listing, hasHistory, firstMessage)) {
    const { error: firstMessageError } = await supabase.from('conversations').insert({
      listing_id: id,
      role: 'assistant',
      content: firstMessage,
      context_snapshot: null,
    })
    if (firstMessageError) {
      console.error(`Failed to persist in_loop first message for listing ${id}:`, firstMessageError.message)
    }
  }

  return (
```

This reuses the `supabase` client already created earlier in `WorkspacePage` (`const supabase = await createClient()`) — no new client needed. `shouldPersistInLoopGreeting` (added to `gate-messages.ts` alongside this task, with its own unit tests) checks `status === 'in_loop'` specifically, not just "not a gate status" — a listing can also have `!hasHistory` while still `intake` (right after upload, before the pipeline reaches `in_loop`), and writing the generic "I'm working on this listing..." placeholder for that status would permanently prevent the real in-loop greeting from ever being shown or persisted (once written, `hasHistory` flips true and `buildWorkspaceContext` never runs again for that listing's `in_loop` phase). It also excludes `agent_blocked` listings: `buildWorkspaceContext` checks `agent_blocked`/`agent_blocked_reason` *before* the status branches, so a listing can be `status: 'in_loop'` with `agent_blocked: true` (set by any pipeline step's `onFailure` handler) and have `firstMessage` be the transient error text rather than the real in-loop greeting — persisting that would be the same permanent-placeholder bug again, just reached through `agent_blocked` instead of a different status. This condition took three code-review rounds to get right (see commits `1d707ef`, `7d07038`, `7a5222b` on this branch), which is why it's a named, independently unit-tested function rather than an inline boolean expression. It only ever fires once per listing: the moment it succeeds, `hasHistory` becomes true on the next load, and the outer ternary above stops calling `buildWorkspaceContext` for `in_loop` states entirely (see spec's "In-loop first-message persistence" section for why this is self-limiting).

- [x] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/listings/\[id\]/page.tsx`
Expected: no errors.

- [x] **Step 3: Manually verify**

Run: `npm run dev`, open a listing with zero conversation history sitting in an `in_loop` sub-state (e.g. one still waiting on studio photos). Reload the page once — confirm no visible UI change (the greeting still renders the same way via `firstMessage`, since `messages.length === 0` still holds on this same load). Then check the database directly:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c \
  "select role, content, created_at from conversations where listing_id = '<the-listing-id>' order by created_at;"
```

Expected: one `assistant` row containing the exact greeting text shown in the UI. Reload the page again — `hasHistory` is now true, so `AgentChat` renders from `initialMessages` instead of a freshly computed `firstMessage`, and no duplicate row gets written.

- [x] **Step 4: Commit**

```bash
git add src/app/listings/\[id\]/page.tsx
git commit -m "feat(listings): persist in_loop first assistant message before any real history exists"
```

---

### Task 4: Persist the `id_gate` exchange in `confirm-id`

**Files:**
- Modify: `src/app/api/pipeline/confirm-id/route.ts`

- [x] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/pipeline/confirm-id/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'
import {
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  synthesizeIdGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { IdGateListing } from '@/lib/pipeline/gate-messages'

export async function POST(request: Request) {
  const body = (await request.json()) as {
    listingId?: string
    confirmed?: boolean
    corrections?: string | null
  }

  if (!body.listingId || body.confirmed === undefined) {
    return NextResponse.json(
      { error: 'listingId and confirmed are required' },
      { status: 400 }
    )
  }

  // Stamp intake immediately so the card stops showing the overlay even
  // before Inngest processes the event (which takes a few seconds).
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: updatedListing, error: updateError } = await supabase
    .from('listings')
    .update({ status: 'intake' })
    .eq('id', body.listingId)
    .eq('status', 'id_gate')
    .select('id, brand, category, condition, condition_notes, intake_meta')
    .maybeSingle()

  if (updateError) {
    console.error('confirm-id: status update failed for listing', body.listingId, updateError.message)
  }

  if (updatedListing) {
    const listing = updatedListing as unknown as IdGateListing
    const confirmed = body.confirmed
    const corrections = body.corrections ?? null

    const { error: insertError } = await supabase.from('conversations').insert([
      {
        listing_id: body.listingId,
        role: 'assistant',
        content: buildIdGatePrompt(listing),
        context_snapshot: buildIdGateSnapshot(listing),
      },
      {
        listing_id: body.listingId,
        role: 'user',
        content: synthesizeIdGateAnswer({ confirmed, corrections, listing }),
        context_snapshot: { confirmed, corrections },
      },
      {
        listing_id: body.listingId,
        role: 'assistant',
        content: buildIdGateAck({ confirmed }),
        context_snapshot: null,
      },
    ])

    if (insertError) {
      console.error('confirm-id: failed to persist gate conversation for listing', body.listingId, insertError.message)
    }
  }

  await inngest.send({
    name: 'pipeline/id-confirmed',
    data: {
      listingId: body.listingId,
      confirmed: body.confirmed,
      corrections: body.corrections ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [x] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/api/pipeline/confirm-id/route.ts`
Expected: no errors.

- [x] **Step 3: Manually verify against the dev DB**

Find or create a listing in `id_gate` status, then confirm it:

```bash
curl -s -X POST http://localhost:3000/api/pipeline/confirm-id \
  -H 'Content-Type: application/json' \
  -d '{"listingId":"<the-listing-id>","confirmed":true}'
```

Then check:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c \
  "select role, content from conversations where listing_id = '<the-listing-id>' order by created_at;"
```

Expected: three rows in order — `assistant` (the "I've analyzed the photo..." prompt), `user` ("Confirmed — ..."), `assistant` ("Confirmed! Running pricing research now...").

Repeat with a listing in `id_gate` status, this time posting `{"listingId":"<id>","confirmed":false,"corrections":"test correction"}` — expect the `user` row to read exactly `test correction` and the trailing `assistant` row to read "Got it — re-running the identification with your correction. The card will update shortly."

Then confirm the duplicate-call guard: POST the same `confirmed:true` request again for a listing that's already left `id_gate` — expect no new rows (still 3 total from the first call), since `.maybeSingle()` returns no row on the second call.

- [x] **Step 4: Commit**

```bash
git add src/app/api/pipeline/confirm-id/route.ts
git commit -m "feat(pipeline): persist id_gate prompt/answer/ack to conversations"
```

---

### Task 5: Persist the `gender_gate` exchange in `confirm-gender`

**Files:**
- Modify: `src/app/api/pipeline/confirm-gender/route.ts`

- [x] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/pipeline/confirm-gender/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  synthesizeGenderGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { GenderGateListing } from '@/lib/pipeline/gate-messages'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    listingId?: string
    gender?: string | null
    measurements?: Record<string, unknown> | null
  }
  const { listingId, gender = null, measurements = null } = body

  if (!listingId) {
    return Response.json({ error: 'listingId is required' }, { status: 400 })
  }

  const { data } = await supabase
    .from('listings')
    .select('status, category, intake_meta')
    .eq('id', listingId)
    .maybeSingle()
  const listing = data as unknown as (GenderGateListing & { status: string }) | null

  if (listing && listing.status === 'gender_gate') {
    const { message, detailGateContext } = buildGenderGatePrompt(listing)

    const { error: insertError } = await supabase.from('conversations').insert([
      {
        listing_id: listingId,
        role: 'assistant',
        content: message,
        context_snapshot: detailGateContext,
      },
      {
        listing_id: listingId,
        role: 'user',
        content: synthesizeGenderGateAnswer({ gender, measurements, detailGateContext }),
        context_snapshot: { gender, measurements },
      },
      {
        listing_id: listingId,
        role: 'assistant',
        content: buildGenderGateAck(),
        context_snapshot: null,
      },
    ])

    if (insertError) {
      console.error('confirm-gender: failed to persist gate conversation:', insertError.message)
    }
  }

  await inngest.send({
    name: 'pipeline/gender-confirmed',
    data: { listingId, gender, measurements },
  })

  return Response.json({ ok: true })
}
```

- [x] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/api/pipeline/confirm-gender/route.ts`
Expected: no errors.

- [x] **Step 3: Manually verify against the dev DB**

This route requires an authenticated session (`auth.getUser()`), which curl can't easily provide — verify through the running app instead. Run `npm run dev`, sign in, and find or advance a listing to `gender_gate` status (a `watches`/`clothing`/`sneakers` category needs gender; e.g. a `handbag` does not). On the listing detail page, answer the gender/measurements prompt through the chat UI as you normally would (e.g. click "Men's", then fill in and submit the measurement form).

Then check:

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c \
  "select role, content from conversations where listing_id = '<the-listing-id>' order by created_at;"
```

Expected: three rows — `assistant` (the "what's the gender and size..." prompt), `user` ("Men's — Waist: 32, Inseam: 30"), `assistant` ("Got it — running pricing research now...").

Repeat with a listing in a non-gendered, measurement-needing category (e.g. `handbag`) — submit its measurements form through the UI and confirm the `assistant` prompt row reads "I need a few measurements..." and the `user` row reads "Height: 10, Width: 6, Depth: 3" (no gender prefix, matching whatever values you entered).

Then confirm the guard: with dev tools open, replay the same POST body (visible in the Network tab) a second time against `/api/pipeline/confirm-gender` for that same listing, now that its status has moved on from `gender_gate` — expect no new conversation rows written (still exactly 3 from the first submission), only the Inngest send still fires.

- [x] **Step 4: Commit**

```bash
git add src/app/api/pipeline/confirm-gender/route.ts
git commit -m "feat(pipeline): persist gender_gate prompt/answer/ack to conversations, add status guard"
```

---

### Post-implementation fix: sequential inserts, not batched

The final holistic branch review (before Task 6) caught a Critical issue in both Task 4 and Task 5's code above: the three-row `conversations.insert([...])` calls in `confirm-id` and `confirm-gender` batch all three rows into one array insert. Postgres fixes `now()` at transaction start, so a single multi-row insert gives every row an identical `created_at` — and the read path (`page.tsx`) sorts by `created_at` with no secondary tiebreaker, so the prompt→answer→ack display order wasn't actually guaranteed, directly undermining the feature's own "Done when" criterion.

Fix (commit `e0ad3b3`): extracted `insertConversationRowsSequentially` in a new file, `src/lib/pipeline/insert-conversation-rows.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConversationRow {
  listing_id: string
  role: 'assistant' | 'user'
  content: string
  context_snapshot: unknown
}

export async function insertConversationRowsSequentially(
  supabase: SupabaseClient,
  rows: ConversationRow[],
  onError: (error: { message: string }) => void
): Promise<void> {
  for (const row of rows) {
    const { error } = await supabase.from('conversations').insert(row)
    if (error) onError(error)
  }
}
```

Both `confirm-id/route.ts` and `confirm-gender/route.ts` were updated to call this helper instead of their original batched `.insert([...])`, passing the same three row objects as before (unchanged content/snapshot shape) plus an `onError` callback matching each route's existing log-message convention. This mirrors the pattern already used in `src/lib/agent/chat.ts` (separate single-row inserts, not batched) — the new helper isn't a novel approach, just a shared, tested version of what the rest of the codebase already does for conversation history.

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the existing `src/lib/platforms/*.test.ts` files and the new `gate-messages.test.ts`.

- [ ] **Step 2: Full typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: End-to-end manual pass through both gates**

Using a fresh listing (upload a new item through the dashboard), walk it through the full intake flow in the running app: confirm `id_gate` via the detail-page chat, then resolve `gender_gate`. Reload the detail page after each step and confirm the prior exchange is still visible in the chat scrollback (this is the actual bug this feature fixes — verify it's gone).

Also test the `ListingCard` fast path: on a different fresh listing sitting in `id_gate`, click "✓ Yes" directly from the dashboard grid (not the detail page), then open that listing's detail page and confirm the exchange appears in history there too.

---

### Task 7: Ship it

**Files:** none (git/PR operations only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/gate-conversation-persistence
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: persist gate conversation history (id_gate/gender_gate)" --body "$(cat <<'EOF'
## Summary
- Extracts gate prompt/answer/ack text into src/lib/pipeline/gate-messages.ts, shared by page.tsx and the two confirm routes
- confirm-id and confirm-gender now write the full 3-turn exchange (prompt, answer, acknowledgment) to `conversations` before sending their Inngest events
- Closes a narrower related gap: an in_loop listing's first greeting is now persisted the one time it's shown before any real chat exists, so background-job-driven state changes can't silently erase it
- confirm-gender gains a status guard it previously lacked entirely

## Test plan
- [x] `npm test` — full suite green, including new gate-messages.test.ts
- [x] `npx tsc --noEmit` clean
- [x] Manual: confirmed id_gate then gender_gate on a fresh listing, verified both exchanges survive a page reload
- [x] Manual: confirmed id_gate via ListingCard's dashboard fast path, verified it appears in the detail page's history too

Closes ai-listings-x9e
EOF
)"
```

- [ ] **Step 3: Merge**

This repo has no required review bots (direct-merge is the established convention here). Once CI is green:

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Watch the deploy**

```bash
gh run watch <run-id> --interval 10 --exit-status
```

- [ ] **Step 5: Verify in production**

Repeat the Task 6 Step 3 manual pass against the deployed app (`https://ai-listings.napoleon-catfish.ts.net`) to confirm the fix is live.

- [ ] **Step 6: Close the tracking issue and clean up**

```bash
bd close ai-listings-x9e --reason="Shipped: gate exchanges (id_gate/gender_gate) now persist as real conversations rows; in_loop first-message gap also closed."
git pull --rebase
bd dolt push
git push
git status
```

Remove the worktree once everything is pushed and merged:

```bash
cd /Users/joe/github/joeblackwaslike/ai-listings
git worktree remove .claude/worktrees/gate-conversation-persistence
```
