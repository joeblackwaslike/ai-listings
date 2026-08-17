# Data-Integrity & Measurements Batch — Design Spec

**Date:** 2026-08-17
**Status:** Approved
**Derived from:** design conversation 2026-08-17 (brainstorming), bd issues `ai-listings-0en`, `ai-listings-5iy`, `ai-listings-b27`, `ai-listings-0wd`, `ai-listings-9ch`

---

## What This Builds

Five independent, file-disjoint fixes opened during code review of the shipping-measurements-finalizing-gate and jewelry-shoe-measurement-gate plans (2026-08-15/16), batched into one implementation pass:

1. **ai-listings-0en** — replaces the read-then-merge-then-write pattern in `PATCH /api/listings/[id]/measurements` (a lost-update race: two independent PATCHes for the same listing can silently clobber each other) with an atomic Postgres-side JSONB merge.
2. **ai-listings-5iy** — `ring_inscribed_size` renders as `<input type="number">` but needs to hold non-numeric stamps (e.g. `"6 1/4"`, worn/illegible).
3. **ai-listings-b27** — `ringDiameterMmToUsSize` has no plausible-range guard; a typo'd input silently produces a nonsense ring size.
4. **ai-listings-0wd** — shipping-box estimation and the gender/measurements gate never run for text-intake listings, only photo-intake — text-intake listings have no path to collect item dimensions.
5. **ai-listings-9ch** — the measurements-submit form in `AgentChat` disappears on submit with no local echo of what was entered, unlike every other confirm-style action in the same component.

**Done when:** the measurements PATCH route uses the new RPC and two sequential PATCHes for the same listing no longer race; `ring_inscribed_size` accepts free text; `ringDiameterMmToUsSize` throws on implausible input instead of silently returning nonsense; a text-intake listing reaches `gender_gate`, collects measurements, and gets an `estimated_shipping_box` exactly like a photo-intake listing does; and submitting the measurements form pushes a `user`-role chat bubble showing what was submitted before the assistant's acknowledgment.

A sixth ticket in the same batch, `ai-listings-kni` (manual smoke test of an already-merged, unrelated feature), is explicitly out of scope for this spec — it isn't code work.

---

## Architecture

No shared architecture ties these five together beyond one incidental overlap: both `0en` and the existing `computeEstimatedShippingBox` logic touch `measurements.estimated_shipping_box`, so `0en`'s box-recompute reuses the same `ShippingBoxDims` shape and lives beside `computeEstimatedShippingBox` in `src/lib/sizing/shipping-box.ts` rather than introducing a second representation.

Each task is designed to be independently testable and independently revertable:

- **0en** introduces the repo's second-ever Postgres RPC (first is `generate_sku`, `0001_initial_schema.sql`), following that function's exact style (`plpgsql`, no `SECURITY DEFINER`, no `GRANT`). Business logic (the box recompute) stays in TypeScript — this repo has no SQL test harness, and duplicating logic into `plpgsql` would make it untestable.
- **5iy** adds one new optional field to the existing `MeasurementField` interface (`textInput?: true`), following the precedent already set by `useChips?: true` — no new component, no new type.
- **b27** adds a guard to a pure function with zero existing callers in production code (confirmed via grep — only its own test file references it today), so this is a forward-compatible hardening with no behavioral risk to anything live.
- **0wd** replicates an existing, working block (`intake-pipeline.ts`'s gender_gate flow) into a second Inngest function, plus widens one already-shared helper (`notableFeaturesOf`) that both pipelines' gate flow depends on.
- **9ch** follows an existing in-file pattern (`confirmId`/`confirmGender`'s local-echo-before-API-call convention) rather than inventing a new one.

---

## File Map

| File | Create / Modify | Ticket | Responsibility |
|------|-----------------|--------|-----------------|
| `supabase/migrations/0018_measurements_merge_rpc.sql` | Create | 0en | `merge_listing_measurements(p_listing_id, p_user_id, p_patch)` RPC |
| `src/lib/sizing/shipping-box.ts` | Modify | 0en | Add `estimatedShippingBoxFromMeasuredBox(measurements)` |
| `src/lib/sizing/shipping-box.test.ts` | Create/Modify | 0en | Unit tests for the new function |
| `src/app/api/listings/[id]/measurements/route.ts` | Modify | 0en | Replace read/merge/write with two `.rpc()` calls |
| `src/types/listings.ts` | Modify | 5iy | Add `textInput?: true` to `MeasurementField` |
| `src/lib/utils.ts` | Modify | 5iy | Set `textInput: true` on the `ring_inscribed_size` field config |
| `src/components/workspace/MeasurementFields.tsx` | Modify | 5iy | Text-input render branch; `handleSubmit` bypass for `textInput` fields |
| `src/lib/sizing/ring-size.ts` | Modify | b27 | Add plausible-range guard (~12–24mm) to `ringDiameterMmToUsSize` |
| `src/lib/sizing/ring-size.test.ts` | Modify | b27 | Boundary tests (`assert.throws` outside, `assert.ok` inside) |
| `src/lib/inngest/functions/text-intake-pipeline.ts` | Modify | 0wd | Insert gender_gate block between text-analysis and pricing-research; pass `gender` to `runStep3PricingResearch` |
| `src/lib/pipeline/gate-messages.ts` | Modify | 0wd | Widen `notableFeaturesOf` to check `textAnalysis` as well as `visionAnalysis` |
| `src/components/workspace/AgentChat.tsx` | Modify | 9ch | `handleMeasurementsSubmit` pushes a local `user`-role echo before the assistant bubble |

---

## Task Designs

### ai-listings-0en — Atomic JSONB merge RPC

**Current bug** (`src/app/api/listings/[id]/measurements/route.ts:54-79`): read `measurements`, spread-merge the patch in application code, write the whole object back. Two concurrent PATCHes (e.g. `FinalizingChecklist.tsx`'s independent box-dims and weight saves) can interleave: PATCH A reads, PATCH B reads-merges-writes, PATCH A's stale merged object then overwrites B's write.

**Migration** (`supabase/migrations/0018_measurements_merge_rpc.sql`):

```sql
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

The merge happens inside the `UPDATE`'s `SET` clause, so it always applies against the row's current on-disk value — concurrent calls serialize on Postgres's normal row lock instead of racing in application code. Ownership is enforced in the same statement (`WHERE id = ... AND user_id = ...`); a mismatched or missing owner returns zero rows, surfaced as `NULL`.

**No `SECURITY DEFINER`, no `GRANT`/`REVOKE`, no key restriction inside the function** — matches the repo's only other RPC (`generate_sku`), and the route's existing `EDITABLE_KEYS` allow-list remains the sole gate on which keys a client can patch. RLS's `owner_access` policy on `listings` (`0002_auth_user_isolation_api_keys.sql:10`) still protects against a client calling this RPC directly with a spoofed `p_user_id`, since the function runs as the invoking role (no `SECURITY DEFINER`) and RLS filters by `auth.uid()` regardless of what the caller passes as `p_user_id`.

**Apply via** (never `supabase db push` — this repo is self-hosted in k8s, forbidden by `AGENTS.md`):
```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0018_measurements_merge_rpc.sql
```

**`route.ts` change:** delete the read-then-check block and the in-app merge. Call the RPC:
```ts
const { data: merged, error } = await supabase.rpc('merge_listing_measurements', {
  p_listing_id: id,
  p_user_id: user.id,
  p_patch: patch,
})
if (error) return Response.json({ error: error.message }, { status: 500 })
if (merged === null) return Response.json({ error: 'Not found' }, { status: 404 })
```
Then, only if `estimatedShippingBoxFromMeasuredBox(merged)` returns non-null, call the RPC a second time with `{ estimated_shipping_box: box }` as the patch, and use that second call's result as the response if it succeeds.

**New pure function**, `src/lib/sizing/shipping-box.ts` (beside the existing `computeEstimatedShippingBox`):
```ts
export function estimatedShippingBoxFromMeasuredBox(measurements: Measurements): ShippingBoxDims | null {
  const { box_length_in, box_width_in, box_height_in } = measurements
  if (box_length_in == null || box_width_in == null || box_height_in == null) return null
  return { length: box_length_in, width: box_width_in, height: box_height_in }
}
```

**Accepted trade-off:** the box recompute is a second, non-atomic RPC call — a small residual race window exists between the two calls, but only for the *derived* `estimated_shipping_box` field, not the user-authored patch fields the original bug was about. It self-heals on the next box-dims PATCH. Full SQL-side atomicity was considered and rejected: this repo has zero precedent for business logic in `plpgsql` and no SQL test harness, so the box logic would be untestable there.

### ai-listings-5iy — `ring_inscribed_size` text input

`MeasurementField` (`src/types/listings.ts:185-191`) gains `textInput?: true`, set on the `ring_inscribed_size` field config (`src/lib/utils.ts:55-59`, the field's only call site). `MeasurementFields.tsx`'s render (lines 72-81) branches to `<input type="text">` (no `min`/`step`) when `field.textInput`. `handleSubmit()` (lines 27-44) gets a third branch alongside the existing chip/numeric ones: when `field.textInput`, store `String(raw)` directly, skipping `parseFloat`/`isNaN`/`n>=0` entirely. An empty string is omitted from the patch, same as every other field's existing blank-skip behavior (line 30) — no special-casing needed.

### ai-listings-b27 — Ring diameter range guard

`ringDiameterMmToUsSize` (`src/lib/sizing/ring-size.ts:9-12`) gets a plausible-range check (~12–24mm) as its first statement, throwing on out-of-range input — matching this repo's one precedent for validation-by-exception (`generate_sku`'s `raise exception`). The function currently has zero production callers (confirmed via grep; only its own test file references it), so this is a forward-compatible hardening, not a behavior change to any live path.

### ai-listings-0wd — Text-intake shipping-box parity

`text-intake-pipeline.ts` gets a gender_gate block inserted between the end of the `text-analysis` step (line 225) and `pricing-research` (line 229), replicating `intake-pipeline.ts:120-181` **in full**: status transition to `gender_gate` (with the `.neq('status','archived')` guard), `step.waitForEvent('gender-gate-confirm', {event:'pipeline/gender-confirmed', timeout:'7d', match:'data.listingId'})`, subtype detection, shoe-size derivation, `computeEstimatedShippingBox`, the `store-gender` write, and the jewelry-subtype LLM fallback. `TextAnalysisOutput` (text-intake's step2 result type) has the same relevant fields as `VisionOutput` (`brand`, `category`, `notable_features`), so the block ports over unchanged aside from which `step2Result`/`supabase` variable is in scope — `text-intake-pipeline.ts` doesn't currently hoist a top-of-function `supabase` client the way `intake-pipeline.ts` does, so this task adds one. On `waitForEvent` timeout (7 days, unconfirmed), the block is skipped entirely and the pipeline falls through to pricing research with `gender: null` — identical to the photo pipeline's behavior, no new timeout-specific logic.

Also fixes the existing 4-arg `runStep3PricingResearch(...)` call (line 231, omits `gender`) to pass `gender` as the 5th arg, matching the photo pipeline's call and the function's actual signature (`gender?: string | null`).

**Shared-code change:** `gate-messages.ts:17-19`'s `notableFeaturesOf` is hardcoded to `intake_meta.visionAnalysis.notable_features`; text-intake writes the identically-shaped data under `intake_meta.textAnalysis.notable_features` instead. Widen to `(intakeMeta?.visionAnalysis ?? intakeMeta?.textAnalysis)?.notable_features ?? []` — the two are mutually exclusive per listing (a listing is either photo-intake or text-intake), so a simple fallback is correct with no merge-both case. This function has three other call sites (`gate-messages.ts` internally, `FieldsPanel.tsx:90`, `agent/tools.ts:158`) that today silently return `[]` for any text-intake listing; this fixes the same gap at all of them as an intentional side effect.

### ai-listings-9ch — Chat echo for measurement submission

`AgentChat.tsx`'s `handleMeasurementsSubmit` (lines 155-166) pushes only an assistant acknowledgment bubble today, never a `user`-role echo of what was submitted — the `MeasurementFields` form just disappears. The sibling `confirmGender` handler (lines 239-257) already does this correctly: `setMessages((prev) => [...prev, {id: uid(), role:'user', content: suggestion.message ?? suggestion.label}])` pushed before its own API call.

Insert an equivalent echo between the existing housekeeping (lines 156-158: `genderGateResolvedRef.current = true`, `setShowMeasurements(false)`, `setSuggestionsDismissed(true)`) and the existing assistant-bubble push (line 159), synthesized from `detailGateContext.measurementFields` mapped through `formatMeasurementValue(field, value)` (`src/lib/units.ts:39-42` — already documented as intended for gate-message display), prefixed with `Gender: X` only when `pendingGender` is set:

```ts
const parts = (detailGateContext?.measurementFields ?? [])
  .filter((f) => measurements[f.key] !== undefined)
  .map((f) => `${f.label}: ${formatMeasurementValue(f, measurements[f.key])}`)
const genderPart = pendingGender ? `Gender: ${pendingGender}` : null
const content = [genderPart, ...parts].filter(Boolean).join(', ')
setMessages((prev) => [...prev, { id: uid(), role: 'user', content }])
```

Requires a new `formatMeasurementValue` import in `AgentChat.tsx`. Handles the no-gender case (no prefix) and the empty-fields case (no dangling separator) via the `filter(Boolean)` join.

**Out of scope for this ticket:** a broader audit of other confirm-style actions missing the same echo (e.g. `suggestion.confirmPhotos` in `handleSuggestionSelect`, ~line 224, which has no echo of any kind and no `return`, falling through) — noted as a candidate for a future pass, not fixed here.

---

## Error Handling

- **0en:** RPC returning `NULL` (not-found or ownership mismatch) maps to HTTP 404, matching the route's existing behavior. RPC error (`error` from `.rpc()`) maps to 500, matching the route's existing `error.message` response shape. The second (box-recompute) RPC call's failure is treated as non-fatal to the request — the first call's result is still a valid response even if the box recompute's follow-up call errors; the box will simply be recomputed on the next PATCH that touches box dims.
- **5iy:** unchanged for every field except `ring_inscribed_size` — no new error paths, since the point of this fix is removing a silent-data-loss path (parseFloat/isNaN dropping non-numeric input), not adding validation.
- **b27:** throws (via a plain `throw new Error(...)`, no existing error-class convention in `src/lib/sizing/`) on out-of-range input. Since the function has no current callers, this introduces no behavior change to any live code path — it's purely forward-compatible hardening for whenever the function is wired up.
- **0wd:** identical to the existing photo-pipeline error handling — the jewelry-subtype LLM fallback already wraps its call in `try/catch` with `console.error` (non-fatal), replicated unchanged.
- **9ch:** no new error paths — this is a synchronous, local state update before the existing (unchanged) `fetch` call; if the fetch itself fails, behavior is unchanged from today (no existing error handling on that fetch either, out of scope for this ticket).

---

## Testing

- **0en:** unit tests for `estimatedShippingBoxFromMeasuredBox` in `src/lib/sizing/shipping-box.test.ts` (all-three-present case, each single-missing-field case → `null`). No API-route test infrastructure exists in this repo (consistent with prior specs) — route-level behavior (404 on non-owner, two-sequential-PATCH no-clobber) is verified manually against the real k8s Supabase after the migration is applied.
- **5iy:** extend `src/lib/utils.test.ts` (already asserts `ring_inscribed_size` field presence/ordering) with an assertion that its config carries `textInput: true`. `MeasurementFields.tsx` has no existing test harness (no `.tsx` tests anywhere in this repo) — verified manually.
- **b27:** extend `src/lib/sizing/ring-size.test.ts` (currently 3 `node:test` cases using `assert.ok(Math.abs(actual-expected)<tolerance)`) with `assert.throws` cases just outside each boundary (~12mm, ~24mm) and `assert.ok` (non-throwing) cases just inside.
- **0wd:** no dedicated unit tests for Inngest step functions exist in this repo today (confirmed — `intake-pipeline.ts` itself has no test file). Verified via manual smoke: submit a text-intake listing, confirm it reaches `gender_gate`, confirm `pipeline/gender-confirmed` resolves it and `estimated_shipping_box` lands in `measurements`. The `notableFeaturesOf` widening is a small pure-function change — add a case to `gate-messages.test.ts` (if it exists) or wherever `notableFeaturesOf`'s existing coverage lives, covering the `textAnalysis`-only fallback path.
- **9ch:** no test harness for this file — verified manually via `npm run dev` against a live `gender_gate` listing, confirming the `user`-role bubble appears with correct content before the assistant's acknowledgment.

---

## Verification

1. `npm test` — baseline 142 tests as of `08e820f`; expect growth from new `ring-size.test.ts` and `shipping-box.test.ts` cases.
2. `npx tsc --noEmit` — one pre-existing unrelated error in `oauth-backend.ts` is expected; no new errors.
3. `npx eslint <changed files>`.
4. Apply migration `0018` via `kubectl exec ... psql` (never `supabase db push`); confirm with a `SELECT` against a test listing that the RPC merges correctly and doesn't clobber a concurrent field.
5. Manual smoke of `0en`: two sequential PATCHes (box dims, then weight) on the same listing — confirm both land in the final `measurements` row.
6. Manual smoke of `0wd`: a text-intake listing reaches `gender_gate`, resolves it, and picks up `estimated_shipping_box`.
7. Manual smoke of `9ch`: submitting the measurements form shows a `user`-role bubble with the submitted values before the assistant's acknowledgment.
8. `bd close` the five tickets; standard session-close git/bd push protocol.

---

## Explicitly Out of Scope

- **`ai-listings-kni`** (manual smoke test of the already-merged metric-units feature) is not part of this spec — it's not code work and needs a live login session; surfaced to Joe separately.
- **RPC-side key validation** for `merge_listing_measurements` — considered and rejected; the route's `EDITABLE_KEYS` allow-list remains the only gate, matching the no-extra-restriction precedent set by `generate_sku`.
- **Full SQL-side atomicity** for the `estimated_shipping_box` recompute — considered and rejected in favor of keeping the logic in testable TypeScript, accepting a small residual (self-healing) race window on that one derived field.
- **The broader `AgentChat`/`ListingCard` confirm-action echo audit** raised in `ai-listings-9ch`'s ticket description — this spec only fixes the concrete `handleMeasurementsSubmit` gap; the audit is noted as a candidate for future work, not performed here.
- **Jewelry-subtype LLM fallback changes** — `0wd` replicates the existing fallback verbatim into the text-intake pipeline; no changes to its own logic are in scope.
