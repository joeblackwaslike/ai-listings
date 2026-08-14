# Metric Measurement Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings-backed metric/imperial input preference to `MeasurementFields`, and dual-unit (`32 in (813 mm)`) display across `FieldsPanel`, listing-description generation, and the persisted gate conversation history.

**Architecture:** A new pure conversion module (`src/lib/units.ts`) is the single source of truth for mm↔inches conversion and per-field formatting; every consumer imports from it. The preference is a new key in the existing generic `user_settings` table, exposed through a settings page mirroring the existing `auto-discount` trio. Stored measurement values stay canonical inches — no schema change, no migration.

**Tech Stack:** Next.js App Router (server components + API routes), Supabase (self-hosted), `node --test` for unit tests (`node --import tsx --test src/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-08-13-metric-measurement-units-design.md`

---

### Task 1: Conversion + formatting library

**Files:**
- Create: `src/lib/units.ts`
- Test: `src/lib/units.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/units.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mmToInches, inchesToMm, formatDualMeasurement, formatMeasurementValue } from './units'
import type { MeasurementField } from '@/types/listings'

test('mmToInches converts millimeters to inches rounded to 2 decimals', () => {
  assert.equal(mmToInches(813), 32.01)
  assert.equal(mmToInches(25.4), 1)
})

test('inchesToMm converts inches to millimeters rounded to nearest whole mm', () => {
  assert.equal(inchesToMm(32), 813)
  assert.equal(inchesToMm(1), 25)
})

test('formatDualMeasurement renders both units', () => {
  assert.equal(formatDualMeasurement(32), '32 in (813 mm)')
})

test('mm -> inches -> mm round trip stays within 1mm', () => {
  for (const mm of [10, 50, 100, 500, 813]) {
    const inches = mmToInches(mm)
    const back = inchesToMm(inches)
    assert.ok(Math.abs(back - mm) <= 1, `round trip drift too large for ${mm}mm: got ${back}mm`)
  }
})

test('formatMeasurementValue dual-formats a plain numeric field', () => {
  const field: MeasurementField = { key: 'waist', label: 'Waist', hint: 'in inches' }
  assert.equal(formatMeasurementValue(field, 32), '32 in (813 mm)')
})

test('formatMeasurementValue passes chip fields through unconverted', () => {
  const field: MeasurementField = {
    key: 'rise', label: 'Rise', hint: 'low, mid, or high', useChips: true, chipOptions: ['Low', 'Mid', 'High'],
  }
  assert.equal(formatMeasurementValue(field, 'mid'), 'mid')
})

test('formatMeasurementValue passes us_size through unconverted (not a physical dimension)', () => {
  const field: MeasurementField = { key: 'us_size', label: 'US Size', hint: 'e.g. 9.5' }
  assert.equal(formatMeasurementValue(field, 9.5), '9.5')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/lib/units.test.ts`
Expected: FAIL — `Cannot find module './units'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/units.ts
import type { MeasurementField } from '@/types/listings'

export function mmToInches(mm: number): number {
  return Math.round((mm / 25.4) * 100) / 100
}

export function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4)
}

export function formatDualMeasurement(inches: number): string {
  return `${inches} in (${inchesToMm(inches)} mm)`
}

// Renders one MeasurementField's stored value the way every display surface (FieldsPanel,
// gate-messages, description prompts) should: chip fields (e.g. rise: low/mid/high) and
// us_size (a shoe size, not a physical dimension) render as-is; every other numeric field
// gets dual-unit text.
export function formatMeasurementValue(field: MeasurementField, value: unknown): string {
  if (field.useChips || field.key === 'us_size') return String(value)
  return formatDualMeasurement(Number(value))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/lib/units.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/units.ts src/lib/units.test.ts
git commit -m "feat(units): add mm/inches conversion and dual-unit formatting"
```

---

### Task 2: Reorder the catch-all dimension fields to width, height, depth

**Files:**
- Modify: `src/lib/utils.ts:86-90`
- Modify: `src/lib/pipeline/gate-messages.test.ts:118`

- [ ] **Step 1: Update `getMeasurementFields()`'s catch-all return**

In `src/lib/utils.ts`, change:

```ts
  // Everything else (handbag, small_leather_goods, electronics, keyboards,
  // collectibles, watches, jewelry, other, etc.) — 3D dimensions
  return [
    { key: 'height', label: 'Height', hint: 'in inches' },
    { key: 'width', label: 'Width', hint: 'in inches' },
    { key: 'depth', label: 'Depth', hint: 'in inches' },
  ]
```

to:

```ts
  // Everything else (handbag, small_leather_goods, electronics, keyboards,
  // collectibles, watches, jewelry, other, etc.) — 3D dimensions
  return [
    { key: 'width', label: 'Width', hint: 'in inches' },
    { key: 'height', label: 'Height', hint: 'in inches' },
    { key: 'depth', label: 'Depth', hint: 'in inches' },
  ]
```

- [ ] **Step 2: Update the existing test that asserts field order**

In `src/lib/pipeline/gate-messages.test.ts`, in `'buildGenderGatePrompt asks for measurements only when the category needs no gender'`, change:

```ts
  assert.deepEqual(detailGateContext.measurementFields.map((f) => f.key), ['height', 'width', 'depth'])
```

to:

```ts
  assert.deepEqual(detailGateContext.measurementFields.map((f) => f.key), ['width', 'height', 'depth'])
```

- [ ] **Step 3: Run the gate-messages test suite to confirm it passes with the reorder**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: PASS (this test file also has two measurement-formatting tests that will currently FAIL — that's expected, Task 7 fixes them; confirm here only that the field-order assertion itself passes)

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils.ts src/lib/pipeline/gate-messages.test.ts
git commit -m "fix(measurements): reorder dimension fields to width, height, depth"
```

---

### Task 3: Measurement-unit preference settings page

**Files:**
- Create: `src/app/settings/measurements/page.tsx`
- Create: `src/app/api/settings/measurements/route.ts`
- Create: `src/components/settings/MeasurementSettings.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Create the API route**

```ts
// src/app/api/settings/measurements/route.ts
import { createClient } from '@/lib/supabase/server'
import { getSetting, setSetting } from '@/lib/user-settings'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const unit = await getSetting(user.id, 'measurement_input_unit')
    return Response.json({ inputUnit: unit === 'metric' ? 'metric' : 'imperial' })
  } catch (err) {
    console.error('measurement settings fetch failed:', err)
    return Response.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { inputUnit?: 'imperial' | 'metric' }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.inputUnit !== 'imperial' && body.inputUnit !== 'metric') {
    return Response.json({ error: 'inputUnit must be "imperial" or "metric"' }, { status: 400 })
  }

  try {
    await setSetting(user.id, 'measurement_input_unit', body.inputUnit, 'string')
  } catch (err) {
    console.error('measurement settings save failed:', err)
    return Response.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Create the client toggle component**

```tsx
// src/components/settings/MeasurementSettings.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface MeasurementSettingsProps {
  initialInputUnit: 'imperial' | 'metric'
}

async function patchInputUnit(inputUnit: 'imperial' | 'metric') {
  await fetch('/api/settings/measurements', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputUnit }),
  })
}

export function MeasurementSettings({ initialInputUnit }: MeasurementSettingsProps) {
  const router = useRouter()
  const [inputUnit, setInputUnit] = useState(initialInputUnit)

  async function select(next: 'imperial' | 'metric') {
    if (next === inputUnit) return
    setInputUnit(next)
    await patchInputUnit(next)
    router.refresh()
  }

  const optionClass = (active: boolean) =>
    `flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
      active
        ? 'border-emerald-500 text-emerald-300 bg-emerald-950'
        : 'border-gray-800 text-gray-400 hover:border-gray-700'
    }`

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-200">Measurement input unit</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => void select('imperial')} className={optionClass(inputUnit === 'imperial')}>
          Imperial (inches)
        </button>
        <button type="button" onClick={() => void select('metric')} className={optionClass(inputUnit === 'metric')}>
          Metric (mm)
        </button>
      </div>
      <p className="text-[11px] text-gray-600">
        {inputUnit === 'metric'
          ? 'The measurements form will ask for millimeters. Every listing still shows both units.'
          : 'The measurements form will ask for fractional inches. Every listing still shows both units.'}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create the settings page**

```tsx
// src/app/settings/measurements/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { MeasurementSettings } from '@/components/settings/MeasurementSettings'

export default async function MeasurementSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const unit = await getSetting(user.id, 'measurement_input_unit')
  const inputUnit = unit === 'metric' ? 'metric' : 'imperial'

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/settings" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Settings
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Measurement Units</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Measurement Units</h1>
          <p className="text-xs text-gray-600 mt-1">
            Choose how you enter measurements on the gate form. Every listing always shows both
            units once entered.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 px-5 py-4">
          <MeasurementSettings initialInputUnit={inputUnit} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add a nav card to the settings index**

In `src/app/settings/page.tsx`, immediately after the existing `Auto-Discount` `<a>` card (closes at `</a>` following the Auto-Discount block) and before the closing `</div>` of the `max-w-lg` container, add:

```tsx
        <a
          href="/settings/measurements"
          className="flex items-center justify-between rounded-xl border border-gray-800 px-5 py-4 hover:border-gray-700 transition-colors group"
        >
          <div>
            <p className="text-sm font-medium text-gray-200">Measurement Units</p>
            <p className="text-[11px] text-gray-600 mt-0.5">
              Metric (mm) or imperial (inches) input on the measurements gate form
            </p>
          </div>
          <span className="text-gray-700 group-hover:text-gray-500 transition-colors">→</span>
        </a>
```

- [ ] **Step 5: Manually verify**

Run `pnpm dev`, sign in, visit `/settings` — confirm the new "Measurement Units" card appears; click through to `/settings/measurements`, toggle to Metric, refresh the page, confirm it stayed selected (persisted via `user_settings`).

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/measurements/page.tsx src/app/api/settings/measurements/route.ts src/components/settings/MeasurementSettings.tsx src/app/settings/page.tsx
git commit -m "feat(settings): add measurement input-unit preference page"
```

---

### Task 4: Metric (mm) input on `MeasurementFields`

**Files:**
- Modify: `src/components/workspace/MeasurementFields.tsx`

- [ ] **Step 1: Add the `inputUnit` prop and mm conversion**

Replace the full contents of `src/components/workspace/MeasurementFields.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import type { MeasurementField, Measurements } from '@/types/listings'
import { mmToInches } from '@/lib/units'

interface MeasurementFieldsProps {
  fields: MeasurementField[]
  inputUnit: 'imperial' | 'metric'
  onSubmit: (measurements: Partial<Measurements>) => void
}

export function MeasurementFields({ fields, inputUnit, onSubmit }: Readonly<MeasurementFieldsProps>) {
  const [values, setValues] = useState<Record<string, string | number>>({})

  function setField(key: string, value: string | number) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    const result: Partial<Measurements> = {}
    for (const field of fields) {
      const raw = values[field.key]
      if (raw === undefined || raw === '') continue
      if (field.useChips) {
        // chip value is stored as lowercase string matching Measurements type
        ;(result as Record<string, unknown>)[field.key] = String(raw).toLowerCase()
      } else {
        const n = parseFloat(String(raw))
        if (!isNaN(n)) {
          (result as Record<string, unknown>)[field.key] = inputUnit === 'metric' ? mmToInches(n) : n
        }
      }
    }
    onSubmit(result)
  }

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-gray-700 bg-gray-900">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">{field.label}</label>
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
          ) : (
            <input
              type="number"
              step={inputUnit === 'metric' ? '1' : '0.5'}
              placeholder={inputUnit === 'metric' ? 'in mm' : field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-28 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={handleSubmit}
        className="self-start mt-1 px-4 py-1.5 text-xs rounded-full border border-emerald-600 text-emerald-300 hover:bg-emerald-950 transition-colors"
      >
        Continue →
      </button>
    </div>
  )
}
```

- [ ] **Step 2: `tsc --noEmit` will now fail at the call site — that's expected and fixed in Task 5**

Run: `npx tsc --noEmit 2>&1 | grep MeasurementFields`
Expected: an error in `AgentChat.tsx` about a missing `inputUnit` prop — confirms the type change took effect; Task 5 fixes the call site.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/MeasurementFields.tsx
git commit -m "feat(measurements): support mm input on MeasurementFields"
```

---

### Task 5: Wire the input-unit preference through to `MeasurementFields`

**Files:**
- Modify: `src/components/workspace/AgentChat.tsx:28-36,122,387-392`
- Modify: `src/app/listings/[id]/page.tsx`

- [ ] **Step 1: Add `inputUnit` to `AgentChatProps` and thread it to `MeasurementFields`**

In `src/components/workspace/AgentChat.tsx`, change the props interface (lines 28-36) from:

```ts
interface AgentChatProps {
  readonly listingId: string
  readonly initialMessages: InitialConversation[]
  readonly firstMessage?: string | null
  readonly suggestions?: Suggestion[] | null
  readonly pendingIdGate?: boolean
  readonly pendingGenderGate?: boolean
  readonly detailGateContext?: DetailGateContext
}
```

to:

```ts
interface AgentChatProps {
  readonly listingId: string
  readonly initialMessages: InitialConversation[]
  readonly firstMessage?: string | null
  readonly suggestions?: Suggestion[] | null
  readonly pendingIdGate?: boolean
  readonly pendingGenderGate?: boolean
  readonly detailGateContext?: DetailGateContext
  readonly inputUnit?: 'imperial' | 'metric'
}
```

Change the component signature (line 122) from:

```ts
export function AgentChat({ listingId, initialMessages, firstMessage, suggestions, pendingIdGate, pendingGenderGate, detailGateContext }: AgentChatProps) {
```

to:

```ts
export function AgentChat({ listingId, initialMessages, firstMessage, suggestions, pendingIdGate, pendingGenderGate, detailGateContext, inputUnit }: AgentChatProps) {
```

Change the `MeasurementFields` render (lines 387-392) from:

```tsx
        {showMeasurements && detailGateContext?.measurementFields && detailGateContext.measurementFields.length > 0 && (
          <MeasurementFields
            fields={detailGateContext.measurementFields}
            onSubmit={(m) => void handleMeasurementsSubmit(m)}
          />
        )}
```

to:

```tsx
        {showMeasurements && detailGateContext?.measurementFields && detailGateContext.measurementFields.length > 0 && (
          <MeasurementFields
            fields={detailGateContext.measurementFields}
            inputUnit={inputUnit ?? 'imperial'}
            onSubmit={(m) => void handleMeasurementsSubmit(m)}
          />
        )}
```

- [ ] **Step 2: Fetch the preference and pass it down in the listing page**

In `src/app/listings/[id]/page.tsx`, add the import:

```ts
import { getSetting } from '@/lib/user-settings'
```

Inside `WorkspacePage`, immediately after `const supabase = await createClient()`, add:

```ts
  const { data: { user } } = await supabase.auth.getUser()
  const measurementInputUnit: 'imperial' | 'metric' = user
    ? (await getSetting(user.id, 'measurement_input_unit')) === 'metric' ? 'metric' : 'imperial'
    : 'imperial'
```

In the JSX, add `inputUnit={measurementInputUnit}` to the `<AgentChat>` call:

```tsx
          <AgentChat
            listingId={id}
            initialMessages={history.map((m) => ({
              id: m.id as string,
              role: m.role as string,
              content: m.content as string,
              created_at: m.created_at as string,
            }))}
            pendingIdGate={listing.status === 'id_gate'}
            pendingGenderGate={listing.status === 'gender_gate'}
            detailGateContext={detailGateContext}
            firstMessage={firstMessage}
            suggestions={suggestions}
            inputUnit={measurementInputUnit}
          />
```

- [ ] **Step 3: Type-check clean**

Run: `npx tsc --noEmit`
Expected: no errors related to `MeasurementFields`/`AgentChat`/`inputUnit`

- [ ] **Step 4: Manually verify**

With the preference set to metric (Task 3), open a listing that's in `gender_gate` status with a category needing measurements (e.g. a handbag) — confirm the form shows mm placeholders and `step="1"`; submit a value and confirm (via `psql` or the `FieldsPanel` from Task 6) it was stored as the correct inches value.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/AgentChat.tsx src/app/listings/\[id\]/page.tsx
git commit -m "feat(measurements): wire input-unit preference into the gate form"
```

---

### Task 6: Dual-unit measurements section in `FieldsPanel`

**Files:**
- Modify: `src/components/workspace/FieldsPanel.tsx`

- [ ] **Step 1: Add imports and computed measurement list**

Change the import line (line 5) from:

```ts
import { formatPrice } from '@/lib/utils'
```

to:

```ts
import { formatPrice, getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
```

Inside the `FieldsPanel` component, alongside the existing computed values (`doneCount`/`failedCount`, around line 84), add:

```ts
  const measurementFields = getMeasurementFields(listing.category ?? '', listing.clothing_sub_type)
  const populatedMeasurements = listing.measurements
    ? measurementFields.filter((field) => {
        const value = (listing.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
```

- [ ] **Step 2: Render the section**

Immediately after the existing `<dl className="space-y-2">...</dl>` block (category/condition/notes, ends around line 199) and before the `{listing.description && (...)}` block, add:

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

- [ ] **Step 3: Manually verify**

Open a listing with populated `measurements` (from Task 5's smoke test, or seed one via `psql`) — confirm the new "Measurements" section renders with dual-unit values, and that a listing with no measurements shows no section at all.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/FieldsPanel.tsx
git commit -m "feat(fields-panel): add dual-unit measurements section"
```

---

### Task 7: Dual-unit formatting in the persisted gate conversation history

**Files:**
- Modify: `src/lib/pipeline/gate-messages.ts`
- Modify: `src/lib/pipeline/gate-messages.test.ts`

- [ ] **Step 1: Update the two measurement-formatting test expectations (red first)**

In `src/lib/pipeline/gate-messages.test.ts`, change:

```ts
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
```

to:

```ts
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
  assert.equal(answer, "Men's — Waist: 32 in (813 mm), Inseam: 30 in (762 mm)")
})
```

And change:

```ts
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
```

to:

```ts
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
  assert.equal(answer, 'Height: 10 in (254 mm), Width: 6 in (152 mm), Depth: 3 in (76 mm)')
})
```

- [ ] **Step 2: Run to verify these two tests now fail**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: FAIL on both updated tests (implementation still returns bare numbers)

- [ ] **Step 3: Update `synthesizeGenderGateAnswer`**

In `src/lib/pipeline/gate-messages.ts`, add the import:

```ts
import { formatMeasurementValue } from '@/lib/units'
```

Change:

```ts
  if (args.measurements) {
    const measurements = args.measurements
    const lines = args.detailGateContext.measurementFields
      .filter((field) => measurements[field.key] !== undefined && measurements[field.key] !== null && measurements[field.key] !== '')
      .map((field) => `${field.label}: ${String(measurements[field.key])}`)
    if (lines.length > 0) parts.push(lines.join(', '))
  }
```

to:

```ts
  if (args.measurements) {
    const measurements = args.measurements
    const lines = args.detailGateContext.measurementFields
      .filter((field) => measurements[field.key] !== undefined && measurements[field.key] !== null && measurements[field.key] !== '')
      .map((field) => `${field.label}: ${formatMeasurementValue(field, measurements[field.key])}`)
    if (lines.length > 0) parts.push(lines.join(', '))
  }
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `node --import tsx --test src/lib/pipeline/gate-messages.test.ts`
Expected: PASS (all tests, including the Task 2 field-order test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/gate-messages.ts src/lib/pipeline/gate-messages.test.ts
git commit -m "feat(gate-messages): dual-unit format measurement answers"
```

---

### Task 8: Measurements in generated listing descriptions — `step4a-draft-listing.ts`

**Files:**
- Modify: `src/lib/pipeline/step4a-draft-listing.ts`

- [ ] **Step 1: Add imports**

At the top of `src/lib/pipeline/step4a-draft-listing.ts`, add:

```ts
import { getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import type { ClothingSubType } from '@/types/listings'
```

- [ ] **Step 2: Fetch measurements and build the prompt line**

After the existing `rulesSection` block (after its closing `catch { }`, before the `const { data: comps } = ...` query), add:

```ts
  const { data: measurementsRow } = await supabase
    .from('listings')
    .select('measurements, clothing_sub_type')
    .eq('id', listingId)
    .single()

  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.clothing_sub_type ?? null) as ClothingSubType | null
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

- [ ] **Step 3: Include it in the prompt**

Change:

```ts
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}

Comparable sold prices:
```

to:

```ts
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}${measurementsLine}

Comparable sold prices:
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manually verify**

Trigger step4a for a listing that has populated `measurements` (e.g. re-run the pipeline on the listing used in Task 5/6's smoke test) — confirm the generated `canonical_description`/`ebay_description` mentions the measurement.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/step4a-draft-listing.ts
git commit -m "feat(pipeline): include dual-unit measurements in step4a listing prompt"
```

---

### Task 9: Measurements in the agent's regenerate-description tool — `agent/tools.ts`

**Files:**
- Modify: `src/lib/agent/tools.ts`

- [ ] **Step 1: Add imports**

Change:

```ts
import type {
  PricingResearchResult,
  AuthChecklistResult,
  ListingDescriptionResult,
  AgentToolError,
} from '@/types/listings'
```

to:

```ts
import { getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import type {
  PricingResearchResult,
  AuthChecklistResult,
  ListingDescriptionResult,
  AgentToolError,
  ClothingSubType,
} from '@/types/listings'
```

- [ ] **Step 2: Extend the `select()` in `buildDescription`**

Change:

```ts
  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('brand, category, condition, condition_notes, tags, inclusions, suggested_price_cents, platform_fields')
    .eq('id', listingId)
    .single()
```

to:

```ts
  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('brand, category, condition, condition_notes, tags, inclusions, measurements, clothing_sub_type, suggested_price_cents, platform_fields')
    .eq('id', listingId)
    .single()
```

- [ ] **Step 3: Build the measurements line**

After the existing `inclusions` computed value:

```ts
  const inclusions = (listing.inclusions as Array<{ item: string; included: boolean }> ?? [])
    .filter((i) => i.included).map((i) => i.item).join(', ') || 'None noted'
```

add:

```ts
  const measurementFields = getMeasurementFields(
    (listing.category as string) ?? '',
    (listing.clothing_sub_type ?? null) as ClothingSubType | null
  )
  const populatedMeasurements = listing.measurements
    ? measurementFields.filter((field) => {
        const value = (listing.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine = populatedMeasurements.length > 0
    ? `\n- Measurements: ${populatedMeasurements
        .map((field) => `${field.label}: ${formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}`)
        .join(', ')}`
    : ''
```

- [ ] **Step 4: Include it in the prompt**

Change:

```ts
- Inclusions: ${inclusions}

Comps (sold prices):
```

to:

```ts
- Inclusions: ${inclusions}${measurementsLine}

Comps (sold prices):
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/tools.ts
git commit -m "feat(agent): include dual-unit measurements in regenerate-description prompt"
```

---

### Task 10: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including every test touched in Tasks 1, 2, and 7

- [ ] **Step 2: Full type-check and build**

Run: `npx tsc --noEmit && pnpm build`
Expected: clean

- [ ] **Step 3: End-to-end manual smoke test**

1. Set the preference to metric on `/settings/measurements`.
2. Create or advance a listing to `gender_gate` for a category needing measurements (e.g. handbag).
3. Submit the form with mm values — confirm via `psql` that `listings.measurements` holds sane inches values.
4. Reload the listing detail page — confirm `FieldsPanel` shows the new "Measurements" section with dual-unit values.
5. Regenerate the listing description (via the agent's `build_description`/`update_listing` flow or by re-running step4a) — confirm it mentions the dual-unit measurement.
6. Confirm the persisted `conversations` row for the gender_gate answer shows the dual-unit string (`psql` the `conversations` table or check `AgentChat`'s scrollback on reload).

- [ ] **Step 4: Update the bd issue and push**

```bash
bd close ai-listings-4zx --reason="Metric input + dual-unit output shipped: settings preference, MeasurementFields mm input, FieldsPanel/description/gate-history dual-unit display"
git status
git push -u origin feat/metric-measurement-units
bd dolt push
```

Then open a PR (`gh pr create`) per the repo's standing PR-autonomy convention.
