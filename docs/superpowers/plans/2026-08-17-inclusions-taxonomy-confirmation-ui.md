# Inclusions Taxonomy + Confirmation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, undifferentiated inclusions list with a category-customized checklist that detection (intake photo, and again on studio photos) checks explicitly, giving each inclusion a `source` (detected/manual) with a confirm/reject workflow, tag attached/severed tracking, and authenticity-card source tracking.

**Architecture:** One new pure-function module (`src/lib/inclusions.ts`) drives checklist selection and merge-on-detection; both photo-analysis call sites (`step2-vision-analysis.ts` for intake, `photo-quality-gate.ts` for studio photos) import it and a shared inclusions-schema helper so the checklist wording exists once; `FieldsPanel.tsx`'s existing Inclusions section is extended in place, not replaced.

**Tech Stack:** TypeScript, Next.js route handlers, Inngest step functions, `node:test`/`assert/strict` for unit tests, Supabase (self-hosted k8s, service-role client for pipeline writes).

**Note on scope:** This is sub-project 1 of 3 (bd `ai-listings-kks`). Condition re-assessment (`ai-listings-e75`) and pricing use of inclusions (`ai-listings-yva`) are explicitly out of scope — see the spec's "Explicitly Out of Scope" section.

---

### Task 1: Inclusion checklist + merge pure functions

**Files:**
- Create: `src/lib/inclusions.ts`
- Test: `src/lib/inclusions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getInclusionChecklist, mergeDetectedInclusions } from './inclusions'
import type { Inclusion } from '@/types/listings'

test('getInclusionChecklist: sneakers gets base checklist plus shoelaces, brand tag, shop bag', () => {
  const checklist = getInclusionChecklist('sneakers', null)
  const items = checklist.map((c) => c.item)
  assert.deepEqual(items, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Extra shoelaces',
    'Brand tag',
    'Shop bag',
  ])
  assert.equal(checklist.find((c) => c.item === 'Brand tag')?.isTag, true)
  assert.equal(checklist.find((c) => c.item === 'Authenticity card')?.isAuthCard, true)
})

test('getInclusionChecklist: watches gets base checklist plus warranty card and instruction booklet', () => {
  const items = getInclusionChecklist('watches', null).map((c) => c.item)
  assert.deepEqual(items, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Warranty/registration card',
    'Instruction booklet',
  ])
})

test('getInclusionChecklist: handbag and small_leather_goods get shop bag, brand tag, reseller tag', () => {
  const handbagItems = getInclusionChecklist('handbag', null).map((c) => c.item)
  const slgItems = getInclusionChecklist('small_leather_goods', null).map((c) => c.item)
  assert.deepEqual(handbagItems, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Shop bag',
    'Brand tag',
    'Reseller tag/UPC',
  ])
  assert.deepEqual(slgItems, handbagItems)
})

test('getInclusionChecklist: unrecognized category falls back to the base checklist only', () => {
  const items = getInclusionChecklist('jewelry', null).map((c) => c.item)
  assert.deepEqual(items, ['Original box', 'Dust bag/cover', 'Authenticity card', 'Receipt'])
})

function detected(item: string, notes: string | null = null): Omit<Inclusion, 'source' | 'confirmed'> {
  return { item, notes }
}

test('mergeDetectedInclusions: empty existing list adds every detected item as pending detected', () => {
  const merged = mergeDetectedInclusions([], [detected('Original box'), detected('Receipt')])
  assert.equal(merged.length, 2)
  assert.ok(merged.every((i) => i.source === 'detected' && i.confirmed === false))
  assert.deepEqual(merged.map((i) => i.item), ['Original box', 'Receipt'])
})

test('mergeDetectedInclusions: skips a detected item whose name already exists (case-insensitive)', () => {
  const existing: Inclusion[] = [{ item: 'original box', source: 'manual', confirmed: true, notes: null }]
  const merged = mergeDetectedInclusions(existing, [detected('Original Box'), detected('Receipt')])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map((i) => i.item), ['original box', 'Receipt'])
  assert.equal(merged[1].source, 'detected')
})

test('mergeDetectedInclusions: with no new items, returns existing list unchanged', () => {
  const existing: Inclusion[] = [{ item: 'Receipt', source: 'manual', confirmed: true, notes: null }]
  const merged = mergeDetectedInclusions(existing, [detected('Receipt')])
  assert.deepEqual(merged, existing)
})

test('mergeDetectedInclusions: preserves tagState and docSource on newly detected items', () => {
  const merged = mergeDetectedInclusions([], [
    { item: 'Brand tag', notes: null, tagState: 'attached' },
    { item: 'Authenticity card', notes: null, docSource: 'original' },
  ])
  assert.equal(merged[0].tagState, 'attached')
  assert.equal(merged[1].docSource, 'original')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/inclusions.test.ts`
Expected: FAIL — `Cannot find module './inclusions'` (the file doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```ts
import type { Inclusion, InclusionSource, ClothingSubType, JewelrySubType } from '@/types/listings'

export interface InclusionChecklistItem {
  item: string
  isTag?: true
  isAuthCard?: true
}

const BASE_CHECKLIST: InclusionChecklistItem[] = [
  { item: 'Original box' },
  { item: 'Dust bag/cover' },
  { item: 'Authenticity card', isAuthCard: true },
  { item: 'Receipt' },
]

export function getInclusionChecklist(
  category: string,
  subType: ClothingSubType | JewelrySubType | null
): InclusionChecklistItem[] {
  if (category === 'sneakers') {
    return [...BASE_CHECKLIST, { item: 'Extra shoelaces' }, { item: 'Brand tag', isTag: true }, { item: 'Shop bag' }]
  }
  if (category === 'watches') {
    return [...BASE_CHECKLIST, { item: 'Warranty/registration card' }, { item: 'Instruction booklet' }]
  }
  if (category === 'handbag' || category === 'small_leather_goods') {
    return [...BASE_CHECKLIST, { item: 'Shop bag' }, { item: 'Brand tag', isTag: true }, { item: 'Reseller tag/UPC' }]
  }
  return BASE_CHECKLIST
}

export function mergeDetectedInclusions(
  existing: Inclusion[],
  detected: Omit<Inclusion, 'source' | 'confirmed'>[]
): Inclusion[] {
  const existingNames = new Set(existing.map((i) => i.item.trim().toLowerCase()))
  const fresh: Inclusion[] = detected
    .filter((d) => !existingNames.has(d.item.trim().toLowerCase()))
    .map((d) => ({ ...d, source: 'detected' as InclusionSource, confirmed: false }))
  return [...existing, ...fresh]
}
```

`subType` is accepted (matching `getMeasurementFields`'s signature so both functions can be called the same way at every call site) but not read by any branch yet — no category currently needs sub-type-level distinction. This is intentional, not a placeholder: revisit only if a future checklist needs it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/inclusions.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (one pre-existing unrelated error in `oauth-backend.ts` is expected)

- [ ] **Step 6: Commit**

```bash
git add src/lib/inclusions.ts src/lib/inclusions.test.ts
git commit -m "feat(inclusions): add checklist selection and merge-on-detection helpers"
```

---

### Task 2: Update the `Inclusion` data model

**Files:**
- Modify: `src/types/listings.ts:57-61`

- [ ] **Step 1: Replace the `Inclusion` interface**

Current (`src/types/listings.ts:57-61`):
```ts
export interface Inclusion {
  item: string;
  included: boolean;
  notes: string | null;
}
```

Replace with:
```ts
export type InclusionSource = 'detected' | 'manual';
export type TagState = 'attached' | 'severed';
export type AuthCardSource = 'original' | 'reseller' | 'third_party';

export interface Inclusion {
  item: string;
  source: InclusionSource;
  confirmed: boolean;
  notes: string | null;
  tagState?: TagState;
  docSource?: AuthCardSource;
}
```

- [ ] **Step 2: Typecheck to find every call site that needs updating**

Run: `npx tsc --noEmit`
Expected: FAIL — errors in `src/lib/pipeline/step2-vision-analysis.ts` (uses `included`), `src/components/workspace/FieldsPanel.tsx` (reads `item.included`, constructs `{ item, included: true, notes: null }`). These are fixed in Tasks 3 and 6 — this step is a checkpoint, not a completion gate. Confirm no *other* files reference `.included` on an `Inclusion`:

Run: `grep -rn "\.included\b" src --include="*.ts" --include="*.tsx"`
Expected: only the two files above

- [ ] **Step 3: Commit**

```bash
git add src/types/listings.ts
git commit -m "feat(inclusions): add source/confirmed/tagState/docSource to Inclusion type"
```

(Leaving `step2-vision-analysis.ts` and `FieldsPanel.tsx` red is expected here — Tasks 3 and 6 fix them. Do not run the full `npm test`/build gate until after Task 6.)

---

### Task 3: Checklist-driven intake detection in step2

**Files:**
- Modify: `src/lib/pipeline/step2-vision-analysis.ts`

- [ ] **Step 1: Add the shared inclusions schema/description helpers and `detectInclusionsFromPhoto`**

Add near the top of the file, after the existing imports (`src/lib/pipeline/step2-vision-analysis.ts:1-6`):

```ts
import { getInclusionChecklist } from '@/lib/inclusions'
import { mergeDetectedInclusions } from '@/lib/inclusions'
import type { InclusionChecklistItem } from '@/lib/inclusions'
```

Add this block after the `LUXURY_BRANDS` set (`:8-34`), before the `VisionAnalysis` interface:

```ts
const INCLUSIONS_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    item: { type: 'string' as const },
    notes: { type: 'string' as const, nullable: true },
    tagState: { type: 'string' as const, enum: ['attached', 'severed'], nullable: true },
    docSource: { type: 'string' as const, enum: ['original', 'reseller', 'third_party'], nullable: true },
  },
  required: ['item', 'notes', 'tagState', 'docSource'],
}

function buildInclusionsDescription(checklist: InclusionChecklistItem[]): string {
  return `Items visible alongside the product. Explicitly check for each of: ${checklist.map((c) => c.item).join(', ')}. Only include items you can actually see -- do not guess at items not visible. For any tag, set tagState to whether it is still attached to the item or has been cut off. For any authenticity card, set docSource: "original" if brand-issued, "reseller" if issued by a resale platform (e.g. TheRealReal's own item-code tag), "third_party" if it's a separate authentication service's documentation.`
}

type DetectedInclusion = { item: string; notes: string | null; tagState?: 'attached' | 'severed'; docSource?: 'original' | 'reseller' | 'third_party' }

export async function detectInclusionsFromPhoto(
  photoUrl: string,
  checklist: InclusionChecklistItem[],
  apiKeys: ApiKeys
): Promise<DetectedInclusion[]> {
  const publicPhotoUrl = await toPublicUrl(photoUrl)
  let output: { inclusions: DetectedInclusion[] }
  try {
    output = await runStructured<{ inclusions: DetectedInclusion[] }>({
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      prompt: 'You are reviewing a studio photo for a resale listing platform. Identify any accessory items visible alongside the product using the extract_inclusions tool.',
      image: { url: publicPhotoUrl },
      apiKey: apiKeys.anthropic,
      toolName: 'extract_inclusions',
      toolDescription: 'Extract accessory items visible in the photo',
      jsonSchema: {
        type: 'object' as const,
        properties: {
          inclusions: {
            type: 'array',
            items: INCLUSIONS_ITEM_SCHEMA,
            description: buildInclusionsDescription(checklist),
          },
        },
        required: ['inclusions'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('detectInclusionsFromPhoto: Claude did not return a tool_use block')
    }
    throw err
  }
  return output.inclusions
}
```

- [ ] **Step 2: Update `VisionOutput`'s inclusions type**

Current (`:55`):
```ts
  inclusions: Array<{ item: string; included: boolean; notes: string | null }>
```

Replace with:
```ts
  inclusions: DetectedInclusion[]
```

- [ ] **Step 3: Compute the checklist and use it in the schema**

Inside `runStep2VisionAnalysis`, after `const publicPhotoUrl = await toPublicUrl(photoUrl)` (`:73`), add:

```ts
  // Checklist is best-effort here -- category is step1's pre-classification hint (possibly
  // 'other' if Lens found no matches), not yet Claude's own authoritative classification,
  // which only exists after this call returns. subType isn't computed until gender_gate,
  // well after this function runs, so it's always null at this call site.
  const checklist = getInclusionChecklist(step1.category, null)
```

Replace the `inclusions` field in the JSON schema (`:168-180`):

```ts
          inclusions: {
            type: 'array',
            items: INCLUSIONS_ITEM_SCHEMA,
            description: buildInclusionsDescription(checklist),
          },
```

Update the `required` array entry `'inclusions'` — no change needed, it's already listed at `:207`.

- [ ] **Step 4: Merge the detected inclusions before writing**

Current (`:231`, inside the `pushPipelineStep` call):
```ts
    inclusions: output.inclusions,
```

Replace with:
```ts
    inclusions: mergeDetectedInclusions([], output.inclusions),
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `step2-vision-analysis.ts` (the `FieldsPanel.tsx` errors from Task 2 remain until Task 6 — that's expected)

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/step2-vision-analysis.ts
git commit -m "feat(inclusions): checklist-driven intake detection in step2"
```

---

### Task 4: Fix ownership check on the inclusions PATCH route

**Files:**
- Modify: `src/app/api/listings/[id]/inclusions/route.ts`

- [ ] **Step 1: Add the ownership filter**

Current (`src/app/api/listings/[id]/inclusions/route.ts:20-23`):
```ts
  const { error } = await supabase
    .from('listings')
    .update({ inclusions: body.inclusions })
    .eq('id', id)
```

Replace with:
```ts
  const { error } = await supabase
    .from('listings')
    .update({ inclusions: body.inclusions })
    .eq('id', id)
    .eq('user_id', user.id)
```

This closes a pre-existing gap: the write goes through `getSupabaseAdmin()` (service-role, bypasses RLS), and previously only filtered by `id` — any authenticated user could overwrite any listing's inclusions by guessing/observing its UUID. A cross-user PATCH now matches zero rows and returns `{ok: true}` with no effect, consistent with how `confirm-gender`'s route already treats a non-owned listing (`src/app/api/pipeline/confirm-gender/route.ts:37-39`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file

- [ ] **Step 3: Manual verification**

Run the dev server (`npm run dev`), and with two different authenticated sessions (or by directly calling the route with a `user.id` that doesn't own the target listing), confirm a PATCH to another user's listing's inclusions returns `{ok: true}` but does not change that listing's `inclusions` in the database. Confirm a PATCH to your own listing still works as before.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/listings/[id]/inclusions/route.ts
git commit -m "fix(inclusions): enforce listing ownership on the PATCH route"
```

---

### Task 5: Studio-photo inclusion detection in photo-quality-gate

**Files:**
- Modify: `src/lib/inngest/functions/photo-quality-gate.ts`

- [ ] **Step 1: Import the new helpers**

Add to the imports (`src/lib/inngest/functions/photo-quality-gate.ts:1-7`):

```ts
import { getInclusionChecklist, mergeDetectedInclusions } from '@/lib/inclusions'
import { detectInclusionsFromPhoto } from '@/lib/pipeline/step2-vision-analysis'
import type { Inclusion } from '@/types/listings'
```

- [ ] **Step 2: Add the detect-inclusions step**

Current (`src/lib/inngest/functions/photo-quality-gate.ts:79-98`):
```ts
    if (!quality.passed) {
      await supabase
        .from('photos')
        .update({
          photoroom_meta: {
            quality_failed: true,
            quality_issues: quality.issues,
            quality_verdict: quality.verdict,
          },
        })
        .eq('id', photoId)

      return { ok: false, listingId, photoId, issues: quality.issues }
    }

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()
```

Insert the new step immediately after the `!quality.passed` block's closing `}`, before the existing `listingRow` select:

```ts
    if (!quality.passed) {
      await supabase
        .from('photos')
        .update({
          photoroom_meta: {
            quality_failed: true,
            quality_issues: quality.issues,
            quality_verdict: quality.verdict,
          },
        })
        .eq('id', photoId)

      return { ok: false, listingId, photoId, issues: quality.issues }
    }

    // Independent of skip_background_removal below -- inclusion detection should run whether
    // or not background removal itself is skipped. Self-contained (own select, own apiKeys
    // fetch) rather than threading state from the later branch, matching how Inngest steps in
    // this codebase are already independent (e.g. intake-pipeline.ts's store-gender step
    // re-reads what it needs rather than relying on an earlier step's return value). Best-effort:
    // a failure here must not block background removal below.
    await step.run('detect-inclusions', async () => {
      try {
        const { data: incRow } = await supabase
          .from('listings')
          .select('user_id, category, sub_type, inclusions')
          .eq('id', listingId)
          .single()
        if (!incRow) return

        const apiKeys = await getUserApiKeys(incRow.user_id)
        const checklist = getInclusionChecklist(incRow.category ?? '', incRow.sub_type)
        const detected = await detectInclusionsFromPhoto(photoUrl, checklist, apiKeys)
        const merged = mergeDetectedInclusions((incRow.inclusions as Inclusion[]) ?? [], detected)
        await supabase.from('listings').update({ inclusions: merged }).eq('id', listingId)
      } catch (err) {
        console.error(`detect-inclusions failed for listing ${listingId}, photo ${photoId}:`, err)
      }
    })

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file

- [ ] **Step 3: Manual verification**

Deploy or run locally against a real studio-photo upload: upload a studio photo for a sneaker listing showing an item not visible in the original intake photo (e.g. a shoelace loose beside the shoe). Confirm the listing's `inclusions` in the database gains a new `source: 'detected', confirmed: false` entry for it, and that any inclusions already present (from intake) are untouched, not duplicated.

- [ ] **Step 4: Commit**

```bash
git add src/lib/inngest/functions/photo-quality-gate.ts
git commit -m "feat(inclusions): detect inclusions from studio photos, merged into existing list"
```

---

### Task 6: FieldsPanel Inclusions UI

**Files:**
- Modify: `src/components/workspace/FieldsPanel.tsx`

- [ ] **Step 1: Update imports**

Current (`src/components/workspace/FieldsPanel.tsx:4`):
```ts
import { ChevronRight, Check, CheckCircle2, Circle, AlertCircle, Plus, SkipForward, X } from 'lucide-react'
```

Replace with:
```ts
import { ChevronRight, Check, CheckCircle2, Circle, AlertCircle, Plus, SkipForward, X, Pencil } from 'lucide-react'
```

Add after the existing imports (`:5-12`):
```ts
import { getInclusionChecklist } from '@/lib/inclusions'
```

- [ ] **Step 2: Add `confirmInclusion` next to the existing inclusion handlers**

Current (`:132-142`):
```ts
  function removeInclusion(i: number) {
    void saveInclusions(inclusions.filter((_, idx) => idx !== i))
  }

  function addInclusion() {
    const name = addInput.trim()
    if (!name) return
    void saveInclusions([...inclusions, { item: name, included: true, notes: null }])
    setAddInput('')
    addInputRef.current?.focus()
  }
```

Replace with:
```ts
  function removeInclusion(i: number) {
    void saveInclusions(inclusions.filter((_, idx) => idx !== i))
  }

  function confirmInclusion(i: number) {
    void saveInclusions(inclusions.map((item, idx) => idx === i ? { ...item, confirmed: true } : item))
  }

  function addInclusion(name?: string) {
    const item = (name ?? addInput).trim()
    if (!item) return
    void saveInclusions([...inclusions, { item, source: 'manual', confirmed: true, notes: null }])
    if (!name) setAddInput('')
    addInputRef.current?.focus()
  }
```

`addInclusion` now takes an optional `name` so quick-add chips (Step 4) can call it directly with a pre-filled item name, while the existing free-text button (Step 4) keeps calling `addInclusion()` with no args, reading from `addInput` exactly as before.

- [ ] **Step 3: Compute quick-add chip candidates**

Add near the other derived values (after `populatedMeasurements`, around `:97`):

```ts
  const checklistCandidates = getInclusionChecklist(listing.category ?? '', listing.sub_type)
    .filter((c) => !inclusions.some((i) => i.item.trim().toLowerCase() === c.item.trim().toLowerCase()))
```

- [ ] **Step 4: Replace the Inclusions section rendering**

Current (`:270-313`):
```tsx
        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Inclusions
          </h3>
          <ul className="space-y-1">
            {inclusions.map((item, i) => (
              <li key={item.item} className="flex items-center gap-2 group">
                {item.included ? (
                  <Check className="w-3.5 h-3.5 flex-none text-emerald-500 shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 flex-none text-gray-700 shrink-0" />
                )}
                <span className={`text-xs flex-1 min-w-0 truncate ${item.included ? 'text-gray-300' : 'text-gray-600'}`}>
                  {item.item}
                  {item.notes && <span className="text-gray-600"> ({item.notes})</span>}
                </span>
                <button
                  onClick={() => removeInclusion(i)}
                  className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-red-400"
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 mt-2">
            <input
              ref={addInputRef}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclusion() } }}
              placeholder="Add inclusion…"
              className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-0.5 transition-colors"
            />
            <button
              onClick={addInclusion}
              disabled={!addInput.trim()}
              className="flex-none text-gray-700 hover:text-emerald-400 disabled:opacity-30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
```

Replace with:
```tsx
        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Inclusions
          </h3>
          <ul className="space-y-1.5">
            {inclusions.map((item, i) => {
              const suffix = item.tagState
                ? item.tagState === 'attached' ? '— still attached' : '— severed'
                : item.docSource === 'original' ? '— original (brand-issued)'
                : item.docSource === 'reseller' ? '— reseller-issued'
                : item.docSource === 'third_party' ? '— third-party verified'
                : item.source === 'manual' ? '— added by you'
                : null

              if (item.source === 'detected' && !item.confirmed) {
                return (
                  <li key={item.item} className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-950/40 border-l-2 border-amber-600">
                    <span className="text-xs flex-1 min-w-0 truncate text-amber-300">
                      {item.item}
                      {suffix && <span className="text-amber-600/70"> {suffix}</span>}
                    </span>
                    <button
                      onClick={() => confirmInclusion(i)}
                      className="flex-none text-emerald-500 hover:text-emerald-400"
                      title="Confirm"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeInclusion(i)}
                      className="flex-none text-gray-600 hover:text-red-400"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                )
              }

              return (
                <li key={item.item} className="flex items-center gap-2 px-2 py-1.5 rounded group">
                  <Check className={`w-3.5 h-3.5 flex-none ${item.source === 'manual' ? 'text-blue-400' : 'text-emerald-500'}`} />
                  <span className="text-xs flex-1 min-w-0 truncate text-gray-300">
                    {item.item}
                    {suffix && <span className={item.source === 'manual' ? 'text-blue-500/70' : 'text-gray-600'}> {suffix}</span>}
                    {item.notes && <span className="text-gray-600"> ({item.notes})</span>}
                  </span>
                  <button
                    className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-gray-400"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeInclusion(i)}
                    className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-red-400"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              )
            })}
          </ul>

          {checklistCandidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 mb-2">
              {checklistCandidates.map((c) => (
                <button
                  key={c.item}
                  onClick={() => addInclusion(c.item)}
                  className="text-[10px] px-2 py-1 rounded-full border border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300 transition-colors"
                >
                  + {c.item}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-2">
            <input
              ref={addInputRef}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclusion() } }}
              placeholder="Add inclusion…"
              className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-0.5 transition-colors"
            />
            <button
              onClick={() => addInclusion()}
              disabled={!addInput.trim()}
              className="flex-none text-gray-700 hover:text-emerald-400 disabled:opacity-30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
```

The Edit (pencil) button is rendered per the spec's approved mockup but has no `onClick` yet — the spec doesn't define what editing an inclusion's notes/tagState/docSource does beyond confirm/reject/remove, and inventing that interaction now would be scope creep beyond what was designed. Leaving it inert (visible, matching the mockup, non-functional) is intentional; wiring it up is a natural follow-up once there's a concrete need, not a defect in this task.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (matches the one known pre-existing unrelated error, nothing new — this closes out the `FieldsPanel.tsx` errors left open since Task 2)

- [ ] **Step 6: Lint**

Run: `npx eslint src/components/workspace/FieldsPanel.tsx`
Expected: clean

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open a listing with pending detected inclusions (or manually seed a listing's `inclusions` column with a mix of detected-pending, detected-confirmed, and manual entries via `kubectl exec ... psql`). Confirm:
- Detected-pending items render with the amber background/left-border and confirm/reject icon buttons
- Clicking confirm moves the item to the plain-row treatment with a green check
- Manual items show the blue check and "— added by you" suffix permanently
- Tag items show attached/severed suffix; auth-card items show the docSource suffix
- Quick-add chips appear for checklist items not yet present, excluding ones already in the list
- Clicking a chip adds it as a confirmed manual entry; free-text add still works
- Hovering a confirmed/manual row reveals the (currently inert) edit and the remove buttons

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace/FieldsPanel.tsx
git commit -m "feat(inclusions): redesign Inclusions UI with confirm/reject and quick-add chips"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 8 new `src/lib/inclusions.test.ts` cases from Task 1; total count grows from the pre-existing baseline with no regressions.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean (one known pre-existing unrelated error in `oauth-backend.ts` is expected; nothing else)

- [ ] **Step 3: Lint every changed file**

Run: `npx eslint src/lib/inclusions.ts src/types/listings.ts src/lib/pipeline/step2-vision-analysis.ts src/app/api/listings/[id]/inclusions/route.ts src/lib/inngest/functions/photo-quality-gate.ts src/components/workspace/FieldsPanel.tsx`
Expected: clean

- [ ] **Step 4: End-to-end manual smoke**

On a real sneaker (or handbag) listing pushed through the full intake pipeline: confirm the intake photo populates checklist-driven inclusions (some pending/amber); confirm one, reject one; upload a studio photo showing an item not visible in the intake photo and confirm it appears as a new pending detected item without duplicating what's already there; add a manual item via a quick-add chip and via free text; reload the page and confirm the "added by you" marker persists.

- [ ] **Step 5: Close the bd ticket**

```bash
bd close ai-listings-kks --reason="Merged: category-customized inclusion checklist, detected/manual confirmation workflow, tag attached/severed + auth-card source tracking, studio-photo re-detection with merge, FieldsPanel UI redesign, inclusions route ownership fix"
bd dolt push
```

(This closes the ticket once the PR containing this whole branch — spec, plan, and every commit above — has merged; do not close before merge.)

---

## Self-Review

**1. Spec coverage** — every spec requirement maps to a task:
- Fixed checklist, category-customized, free-text fallback → Task 1 (`getInclusionChecklist`) + Task 6 (free-text input unchanged)
- Detection at intake and again on studio photos, merged not duplicated → Task 3 (intake) + Task 5 (studio) + Task 1 (`mergeDetectedInclusions`, shared by both)
- `source`/`confirmed` with confirm/reject, reject = delete → Task 2 (type) + Task 6 (`confirmInclusion`/`removeInclusion`)
- `tagState`/`docSource` → Task 2 (type) + Task 3 (schema/prompt) + Task 6 (UI suffix rendering)
- FieldsPanel visual redesign (amber/plain/blue, icon-only, quick-add chips) → Task 6
- Ownership fix on the inclusions route → Task 4
- Shared prompt-building helper (checklist wording exists once) → Task 3 (`INCLUSIONS_ITEM_SCHEMA`, `buildInclusionsDescription`, `detectInclusionsFromPhoto` all live in `step2-vision-analysis.ts` and are imported by `photo-quality-gate.ts` in Task 5)

**2. Placeholder scan** — no TBD/TODO in any step; every code block is complete, runnable code, not a description of what to write. The one intentionally-inert piece (the Edit/pencil button's `onClick`) is explicitly called out with its reasoning in Task 6, not left as a silent gap.

**3. Type consistency** — verified across tasks: `Inclusion`'s fields (`item`, `source`, `confirmed`, `notes`, `tagState?`, `docSource?`) defined in Task 2 match every construction site in Tasks 3 (`mergeDetectedInclusions([], output.inclusions)`), 5 (`mergeDetectedInclusions(existing, detected)`), and 6 (`{ item, source: 'manual', confirmed: true, notes: null }`). `getInclusionChecklist(category, subType)`'s signature (Task 1) matches every call site: Task 3 passes `(step1.category, null)`, Task 5 passes `(incRow.category ?? '', incRow.sub_type)`, Task 6 passes `(listing.category ?? '', listing.sub_type)` — all three supply a `string` and a `ClothingSubType | JewelrySubType | null`, matching the declared parameter types. `detectInclusionsFromPhoto`'s return type (`DetectedInclusion[]`, Task 3) matches what `mergeDetectedInclusions`'s second parameter expects (`Omit<Inclusion, 'source' | 'confirmed'>[]`) — `DetectedInclusion` (`{item, notes, tagState?, docSource?}`) is structurally identical to that `Omit`.

**Spec deviation found and resolved during this plan:** the spec's step2 task design claimed "category/subType are already available at this point in the function" — true for `category` (via `step1.category`, a hint) but not for `subType`, which is only computed later in `gate-messages.ts` at the gender_gate stage, after step2 already ran. Task 3 passes `null` for `subType` at this call site instead, with a comment explaining why. This is safe: `getInclusionChecklist`'s current implementation (Task 1) never reads `subType` in any branch, so this doesn't change behavior — only documents accurately what's really available where the spec was imprecise.
