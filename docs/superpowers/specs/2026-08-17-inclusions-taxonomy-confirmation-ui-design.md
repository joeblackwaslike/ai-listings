# Inclusions Taxonomy + Detected/Manual Confirmation UI — Design Spec

**Date:** 2026-08-17
**Status:** Approved
**Derived from:** brainstorming session 2026-08-17, bd issue `ai-listings-kks`

---

## What This Builds

Sub-project 1 of a 3-part pipeline-accuracy redesign (see `ai-listings-e75` for condition gating and `ai-listings-yva` for pricing retiming — both depend on this one, neither is spec'd yet).

The single intake photo is good enough for identification but not for capturing what physically comes with an item — boxes, dust bags/covers, shop bags, authenticity cards, receipts, warranty cards, extra shoelaces, tags, instruction booklets, reseller tags (e.g. TheRealReal's own item-code tag). Today `Inclusion` is detected once from that single photo and the UI only supports add/remove — no way to distinguish "the AI guessed this, please confirm" from "I added this myself," no tracking of whether a tag is still attached or severed, no tracking of which authority issued an authenticity card.

This spec:
1. Adds a fixed accessory-category checklist that detection explicitly checks every time (instead of vaguely noting "stuff visible in the photo"), customized per listing category, with free text still available for anything unusual.
2. Runs that detection at intake (as today) **and again** when studio photos are uploaded, merging into the existing list instead of duplicating.
3. Gives each inclusion a `source` (`detected` vs `manual`) and a confirm/reject workflow for detected items — reject just deletes it, no "confirmed absent" tracking.
4. Adds `tagState` (attached/severed) for tag-type items and `docSource` (original/reseller/third_party) for authenticity-card-type items.
5. Redesigns the Inclusions section of `FieldsPanel.tsx` to visually distinguish detected-pending (amber, needs review) from confirmed (plain) from manual (blue, permanent marker), with icon-only actions and quick-add chips from the same checklist.

**Done when:** a listing's intake photo populates inclusions using the fixed checklist; uploading a studio photo re-runs detection and merges new finds without duplicating existing ones; the FieldsPanel Inclusions section shows detected-pending items with confirm/reject actions, confirmed items settle to a plain look, and manually-added items keep a permanent "added by you" marker; the quick-add chips and free-text input both work; and the inclusions PATCH route enforces listing ownership (a gap fixed as part of touching this route).

---

## Architecture

No new files beyond one small domain module. Everything else is a modification of an existing, working piece:

- **Taxonomy + checklist selection** is a new pure function, `getInclusionChecklist(category, subType)`, in a new `src/lib/inclusions.ts` — mirrors the existing `getMeasurementFields(category, subType, notableFeatures)` pattern in `src/lib/utils.ts:41-136` exactly (same shape of category-branching, same kind of module boundary sizing already used for jewelry detection in `src/lib/jewelry-detection.ts`). This repo already has precedent for category-keyed config living in small dedicated modules rather than growing `utils.ts` further.
- **Merge-on-detection** is also a pure function in `src/lib/inclusions.ts` — `mergeDetectedInclusions(existing, detected)` — case-insensitive name match against `existing`, skips anything already present (any source/state), returns only genuinely new items as pending `detected` entries. Both step2 (intake) and the new studio-photo detection call site use this same function, so there's one merge rule, not two.
- **Detection itself** stays inside the existing vision-analysis call sites (`step2-vision-analysis.ts`'s structured-output schema gains explicit per-category checklist prompting) rather than becoming a separate LLM call — this follows the existing pattern where inclusions, condition, and notable_features are all extracted from the same single Claude vision call, not three separate ones.
- **Studio-photo re-detection** hooks into `photo-quality-gate.ts` (the function that already runs a Claude vision call — `checkPhotoQuality` — against every studio photo). Rather than adding a second Claude vision call for inclusions, the same photo gets a second structured-output extraction call for inclusions after quality passes. This keeps the "detect inclusions from studio photos" requirement scoped to *this* spec without touching the human-escalation/re-shoot design that belongs to `ai-listings-e75`.
- **UI** stays entirely inside `FieldsPanel.tsx`'s existing Inclusions section (`src/components/workspace/FieldsPanel.tsx:270-313`) — no new component file. The section already has local state (`inclusions`, `addInput`) and a save path (`saveInclusions` → `PATCH /api/listings/[id]/inclusions`); this spec extends both without restructuring them.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|-----------------|
| `src/lib/inclusions.ts` | Create | `getInclusionChecklist(category, subType)`, `mergeDetectedInclusions(existing, detected)` |
| `src/lib/inclusions.test.ts` | Create | Unit tests for both functions |
| `src/types/listings.ts` | Modify | `Inclusion` gains `source`, `tagState`, `docSource`; drops unused `included` |
| `src/lib/pipeline/step2-vision-analysis.ts` | Modify | Inclusions schema/prompt driven by the checklist; tag/auth-card items request `tagState`/`docSource`; output passes through `mergeDetectedInclusions` against the (empty, at intake) existing list |
| `src/lib/inngest/functions/photo-quality-gate.ts` | Modify | After quality passes, run a second structured-output call extracting inclusions from the studio photo; merge via `mergeDetectedInclusions` against the listing's current inclusions and persist |
| `src/app/api/listings/[id]/inclusions/route.ts` | Modify | Add ownership check (`user_id` filter) to the update; accept the new fields |
| `src/components/workspace/FieldsPanel.tsx` | Modify | Inclusions section: confirm/reject/edit icon actions, amber/plain/blue state treatment, quick-add chips from `getInclusionChecklist` |

---

## Task Designs

### Data model (`src/types/listings.ts`)

Current (`:56-59`):
```ts
export interface Inclusion {
  item: string;
  included: boolean;
  notes: string | null;
}
```

New:
```ts
export type InclusionSource = 'detected' | 'manual';
export type TagState = 'attached' | 'severed';
export type AuthCardSource = 'original' | 'reseller' | 'third_party';

export interface Inclusion {
  item: string;
  source: InclusionSource;
  confirmed: boolean;       // detected items start false; manual items are created true
  notes: string | null;
  tagState?: TagState;      // only meaningful when item represents a tag
  docSource?: AuthCardSource; // only meaningful when item represents an authenticity card
}
```

`included` is dropped — nothing will ever set it `false` under the new "reject deletes the entry" rule, so it would be a permanently-true, meaningless field. Every existing read of `item.included` in `FieldsPanel.tsx` (`:277-282`) is replaced by branching on `confirmed`/`source` instead (see UI section below).

### `src/lib/inclusions.ts` (new)

```ts
import type { Inclusion, InclusionSource, ListingCategory } from '@/types/listings'
import type { ClothingSubType, JewelrySubType } from '@/types/listings'

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

`subType` follows the existing `getMeasurementFields` signature exactly so both functions can be called with the same values already computed at each call site (`detectClothingSubType`/`detectJewelrySubType` results already available in `gate-messages.ts` and `step2-vision-analysis.ts`'s callers). Category branches cover the categories with the most distinctive accessory sets (sneakers, watches, handbags/small leather goods); everything else gets `BASE_CHECKLIST`, matching how `getMeasurementFields` itself has a generic fallback branch.

### `step2-vision-analysis.ts` — intake-photo detection

The `inclusions` field in the structured-output schema (`:168-180`) changes shape to match the new `Inclusion` fields (minus `source`/`confirmed`, which the merge step adds) and the prompt gets the checklist injected explicitly:

```ts
inclusions: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      item: { type: 'string' },
      notes: { type: 'string', nullable: true },
      tagState: { type: 'string', enum: ['attached', 'severed'], nullable: true },
      docSource: { type: 'string', enum: ['original', 'reseller', 'third_party'], nullable: true },
    },
    required: ['item', 'notes', 'tagState', 'docSource'],
  },
  description: `Items visible alongside the product. Explicitly check for each of: ${checklist.map((c) => c.item).join(', ')}. Only include items you can actually see -- do not guess at items not visible. For any tag, set tagState to whether it is still attached to the item or has been cut off. For any authenticity card, set docSource: "original" if brand-issued, "reseller" if issued by a resale platform (e.g. TheRealReal's own item-code tag), "third_party" if it's a separate authentication service's documentation.`,
},
```

`checklist` is computed via `getInclusionChecklist(category, subType)` before the prompt is built — `category`/`subType` are already available at this point in the function (the same values used to build the rest of the prompt). After the structured call returns, `output.inclusions` is passed through `mergeDetectedInclusions([], output.inclusions)` (existing is empty at intake) before being written via `pushPipelineStep`, so the stored shape always has `source`/`confirmed` populated — no separate code path for "intake-shaped" vs "studio-shaped" inclusion records.

### `photo-quality-gate.ts` — studio-photo detection

The existing function only selects `user_id, skip_background_removal` (`:94-98`) and only computes `apiKeys`/fetches `raw_url` inside the non-skipped background-removal branch (`:100-116`) — neither is available yet at the point quality passes. Inclusion detection is independent of `skip_background_removal` (it should run whether or not background removal itself is skipped), so it gets its own self-contained `step.run` right after the existing `!quality.passed` early return (`:79-92`, unchanged), with its own select and its own `apiKeys` fetch rather than threading state through the later branch:

```ts
// after the existing "if (!quality.passed) { ...; return }" block, before the
// existing listingRow/skip_background_removal select
await step.run('detect-inclusions', async () => {
  const { data: listingRow } = await supabase
    .from('listings')
    .select('user_id, category, sub_type, inclusions')
    .eq('id', listingId)
    .single()
  if (!listingRow) return

  const apiKeys = await getUserApiKeys(listingRow.user_id)
  const checklist = getInclusionChecklist(listingRow.category ?? '', listingRow.sub_type)
  const detected = await detectInclusionsFromPhoto(photoUrl, checklist, apiKeys)
  const merged = mergeDetectedInclusions((listingRow.inclusions as Inclusion[]) ?? [], detected)
  await supabase.from('listings').update({ inclusions: merged }).eq('id', listingId)
})
```

This duplicates one `getUserApiKeys` call against the existing background-removal branch's own fetch (`:114`) — accepted redundancy, matching how Inngest steps in this codebase are already self-contained rather than threading fetched state between `step.run` calls (e.g. `intake-pipeline.ts`'s `store-gender` step re-reads what it needs rather than relying on an earlier step's return value). `detectInclusionsFromPhoto` is a small new export next to `runStep2VisionAnalysis`'s structured-output pattern — same `runStructured` call shape, same checklist-driven prompt as step2's, reused rather than duplicated (extract the prompt-building into a shared helper both call sites import, so the checklist wording only exists once).

### `src/app/api/listings/[id]/inclusions/route.ts` — ownership fix

Current update (`:20-23`) filters only by `id`, not `user_id` — any authenticated user can currently overwrite any listing's inclusions by guessing/observing its UUID, since the write goes through the service-role client (`getSupabaseAdmin()`), bypassing RLS. Fix:
```ts
const { error } = await supabase
  .from('listings')
  .update({ inclusions: body.inclusions })
  .eq('id', id)
  .eq('user_id', user.id)
```
This is a pre-existing gap, not something this spec's other changes introduce — fixed here because this route is already being touched and the fix is one line.

### `FieldsPanel.tsx` — UI

Replaces the list rendering (`:274-295`) and add-input (`:296-312`). Per-item rendering branches on `item.source`/`item.confirmed`:

- **`source === 'detected' && !confirmed`** — amber background (`bg-amber-950/40`), left border (`border-l-2 border-amber-600`), text `text-amber-300`. Two icon-only buttons: check (`lucide-react` `Check`, calls a new `confirmInclusion(i)` that sets `confirmed: true` and saves) and X (`lucide-react` `X`, calls existing `removeInclusion(i)`).
- **`confirmed` (either source)** — plain row, small leading check icon colored by source (`text-emerald-500` if `source === 'detected'`, `text-blue-400` if `source === 'manual'`), text `text-gray-300`. Manual items additionally show `— added by you` in `text-blue-500/70`. Hover reveals edit (pencil, `lucide-react` `Pencil`) and remove (X) buttons, matching the existing hover-reveal convention already used for `removeInclusion` (`group`/`group-hover:opacity-100`, `:288`).
- Tag items show `— still attached` / `— severed` after the item name when `tagState` is set; auth-card items show `— original (brand-issued)` / `— TheRealReal-style reseller tag` / `— third-party verified` after the item name when `docSource` is set (small `text-gray-600` suffix, matching the existing `item.notes` suffix convention at `:284`).

Below the list, quick-add chips render from `getInclusionChecklist(listing.category ?? '', listing.sub_type)`, filtered to exclude checklist items already present in `inclusions` (case-insensitive match, same rule as `mergeDetectedInclusions`). Each chip click calls `addInclusion` with that item's name pre-filled (`source: 'manual'`, `confirmed: true`), same save path as the existing free-text add. The existing free-text input/button (`:296-312`) is unchanged in position, now sitting below the chip row.

All icons switch to icon-only (no button text), matching the mockup approved during brainstorming (`.superpowers/brainstorm/77353-1787006158/content/fieldspanel-integrated.html`) — `title` attributes retained for hover tooltips/accessibility.

---

## Error Handling

- `getInclusionChecklist`/`mergeDetectedInclusions` are pure functions — no error paths, covered by unit tests instead.
- `detectInclusionsFromPhoto` (studio-photo path) follows the existing `ClaudeStructuredOutputError` handling pattern already used in `step2-vision-analysis.ts` (`:209-214`) and `photo-quality-gate.ts` (`:55-60`) — rethrows as a clear `Error` with a `[step]:` prefix; an Inngest `step.run` failure here does not block the rest of `photo-quality-gate.ts` (background removal still runs) since inclusion detection is a best-effort enrichment, not a pipeline-blocking step. Wrap the `detect-inclusions` step body in try/catch with `console.error`, matching the non-fatal convention already used for `jewelry-subtype-llm-fallback` in `intake-pipeline.ts:170-182`.
- `inclusions` route: unchanged 400/401/500 behavior, plus the ownership filter turns a cross-user PATCH into a silent no-op (zero rows matched) rather than a 404/403 — matches how `confirm-gender`'s route already treats a non-owned listing (`route.ts:37-39`, returns `{ok: true}` without acting), so this is consistent with the existing convention in this codebase rather than introducing a new error-response shape.

---

## Testing

- `src/lib/inclusions.test.ts` (new, `node:test`/`assert/strict`, matching every other `src/lib/**` test file's style): `getInclusionChecklist` per-category branches (sneakers/watches/handbag/fallback) and `mergeDetectedInclusions` (empty existing, case-insensitive dedup, partial overlap, all-new).
- `step2-vision-analysis.ts`/`photo-quality-gate.ts`: no existing test harness (both do live I/O against Claude/Supabase, consistent with the rest of `src/lib/pipeline/` and `src/lib/inngest/functions/`) — verified manually: upload an intake photo for a sneaker/watch/handbag listing and confirm the checklist-appropriate inclusions appear pending; upload a studio photo showing a previously-undetected item (e.g. a shoelace not visible in the intake photo) and confirm it gets added without duplicating already-present items.
- `FieldsPanel.tsx`: no test harness for `.tsx` files anywhere in this repo — verified manually via `npm run dev`: confirm/reject buttons update state and persist, quick-add chips populate and exclude already-present items, edit/remove hover behavior, and the three visual states (amber-pending, plain-confirmed, blue-manual) render as approved in the mockup.
- Ownership fix: manual smoke test — attempt a PATCH to `/api/listings/[id]/inclusions` for a listing owned by a different user (or simulate via a second test account) and confirm it no longer succeeds.

---

## Verification

1. `npm test` — expect growth from the new `inclusions.test.ts` cases; no regressions.
2. `npx tsc --noEmit` clean (aside from the one known pre-existing unrelated error).
3. `npx eslint` on all changed files.
4. Manual smoke: full flow on a real sneaker listing — intake photo populates checklist-driven inclusions (some pending, amber); confirm one, reject one; upload a studio photo showing an item not in the intake photo, confirm it appears as a new pending detected item; add a manual item via a quick-add chip and via free text; confirm the "added by you" marker persists after a page reload.
5. `bd close ai-listings-kks`; standard session-close git/bd push protocol.

---

## Explicitly Out of Scope

- **Brand-level checklist customization** (e.g. Chanel-specific vs. generic jewelry) — category-level customization only in this pass; revisit if the category-level checklist proves insufficient in practice.
- **"Confirmed absent" tracking** for rejected detected items — rejecting just deletes the entry, no record kept.
- **Photo quality gate / human QA escalation / condition re-assessment** — all of `ai-listings-e75`, not touched here beyond adding one more structured-output call inside `photo-quality-gate.ts`'s existing quality-passed branch.
- **The duplicate/racing Inngest handler bug** (`ai-listings-qd4`, `photo-quality-gate.ts` vs `studio-photo-process.ts` both calling `removeBackground`) — a real, separate bug found during this spec's research; fixed independently, not part of this change.
- **Pricing use of inclusions** (dollar-amount premiums, complete-set bonus, authenticity-threshold-aware pricing) — all of `ai-listings-yva`, depends on this spec's data model but the pricing logic itself is a separate spec.
