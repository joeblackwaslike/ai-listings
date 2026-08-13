# Gate Conversation Persistence — Design Spec

**Date:** 2026-08-13
**Status:** Approved
**Derived from:** design conversation 2026-08-13, bd issue `ai-listings-x9e`

---

## What This Builds

The `id_gate` ("is this correct?") and `gender_gate` (gender/measurements) prompts shown in `AgentChat` and `ListingCard` are regenerated fresh every time from the listing's *current* status, via `buildWorkspaceContext()` in `src/app/listings/[id]/page.tsx`. Confirming a gate flips the listing's status column and moves on — nothing is written to the `conversations` table. Once a listing moves from `id_gate` to `gender_gate`, the earlier "is this correct?" exchange vanishes, replaced by an unrelated fresh prompt.

This spec adds real `conversations` rows whenever a gate is confirmed, so `AgentChat`'s `initialMessages` scrollback shows the whole intake conversation, gates included, on every future page load. Each exchange is three turns, matching what the live UI actually shows today: an `assistant` row for the generated prompt, a `user` row for the answer, and a trailing `assistant` row for the acknowledgment (e.g. "Confirmed! Running pricing research now…") that `AgentChat.tsx` currently only ever renders client-side and never persists.

**Done when:** confirming an `id_gate` or `gender_gate` (from either the detail-page chat or the dashboard-card fast path) writes the prompt, answer, and acknowledgment as three `conversations` rows, and reloading the listing detail page shows the full three-turn exchange in the chat history.

---

## Architecture

Extract the gate-prompt text logic currently inlined in `page.tsx`'s `idGateContext()` / `genderGateContext()` into a new pure module, `src/lib/pipeline/gate-messages.ts`. Both the RSC page (live rendering) and the two confirm API routes (persistence) call the same functions, so the persisted row always matches exactly what was shown on screen — no duplicated logic, no trusting client-supplied text for what gets stored.

`page.tsx`'s `idGateContext()` / `genderGateContext()` become thin wrappers: call the shared builder for the message text, then attach the UI-only `suggestions` array (buttons/labels are a rendering concern, not part of the persisted content).

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|-----------------|
| `src/lib/pipeline/gate-messages.ts` | Create | Pure functions: prompt text, snapshot data, answer synthesis (see below) |
| `src/lib/pipeline/gate-messages.test.ts` | Create | Unit tests for the above, `node --test` convention |
| `src/app/listings/[id]/page.tsx` | Modify | `idGateContext()`/`genderGateContext()` call the shared builders instead of inlining the text |
| `src/app/api/pipeline/confirm-id/route.ts` | Modify | Fetch listing, build + insert the prompt/answer/ack conversation rows before sending the existing Inngest event |
| `src/app/api/pipeline/confirm-gender/route.ts` | Modify | Guard on `status === 'gender_gate'`, build + insert the prompt/answer/ack conversation rows before sending the existing Inngest event |

No changes to `AgentChat.tsx`, `ListingCard.tsx`, or the Inngest pipeline function (`intake-pipeline.ts`) — the persistence lives entirely in the two API routes both entry points already call.

---

## `gate-messages.ts` — Exports

```ts
buildIdGatePrompt(listing: Listing): string
buildIdGateSnapshot(listing: Listing): Record<string, unknown>
// { brand, category, condition, condition_notes, notable_features }

buildGenderGatePrompt(listing: Listing): { message: string; detailGateContext: DetailGateContext }

synthesizeIdGateAnswer(args: {
  confirmed: boolean
  corrections: string | null
  listing: Listing
}): string
// confirmed=true  -> "Confirmed — Rolex watches, condition: good."
// confirmed=false -> the raw corrections text verbatim (already the real user message)

synthesizeGenderGateAnswer(args: {
  gender: string | null
  measurements: Record<string, unknown> | null
  detailGateContext: DetailGateContext
}): string
// "Men's" / "Women's" / "Unisex", plus one line per measurement field using
// detailGateContext.measurementFields labels, e.g. "Waist: 32, Inseam: 30"
// (readable text now; will gain unit-aware formatting when ai-listings-4zx lands)

buildIdGateAck(args: { confirmed: boolean }): string
// confirmed=true  -> "Confirmed! Running pricing research now — the listing will update in a moment."
// confirmed=false -> "Got it — re-running the identification with your correction. The card will update shortly."

buildGenderGateAck(): string
// "Got it — running pricing research now. The listing will update in a moment."
```

`buildIdGateAck`/`buildGenderGateAck` are extracted verbatim from the fixed strings `AgentChat.tsx` already pushes into local state after each confirm action (lines 235, 274, 252/158) — this spec just gives the route a way to persist the same text server-side, it does not change what's shown live.

The `user` row's `context_snapshot` is the raw confirm payload the route received — `{ confirmed, corrections }` for id_gate, `{ gender, measurements }` for gender_gate — separate from the `assistant` prompt row's snapshot (the listing-derived data the prompt was built from). Together the two snapshots let a future reader reconstruct "what the system showed" vs. "what the user actually sent" without re-parsing `content`. The trailing `assistant` ack row carries no `context_snapshot` (`null`) — it's a fixed acknowledgment string, not derived from any per-request data.

`buildIdGatePrompt`/`buildIdGateSnapshot`/`buildGenderGatePrompt` are extracted verbatim from the existing `idGateContext`/`genderGateContext` logic in `page.tsx` — no behavior change to what's displayed. `synthesizeIdGateAnswer`/`synthesizeGenderGateAnswer` are new, but mirror the optimistic-UI text `AgentChat.tsx` already produces client-side today (e.g. the `Confirmed — ${brand} ${category}, condition: ${condition}.` string built inline in `idGateContext`'s suggestion).

---

## Data Flow

**`POST /api/pipeline/confirm-id`**

1. Update `listings.status` `id_gate → intake`, adding `.select('id, brand, category, condition, condition_notes, intake_meta')` to the existing `.eq('id', ...).eq('status', 'id_gate')` update — one round trip gives both the success signal (row returned or not) and the data needed for the prompt text (unaffected by this update, so pre/post values are identical).
2. If a row came back (the flip actually happened), insert three `conversations` rows in order:
   - `assistant`: `buildIdGatePrompt` + `buildIdGateSnapshot`
   - `user`: `synthesizeIdGateAnswer({confirmed, corrections, listing})`, snapshot = `{confirmed, corrections}`
   - `assistant`: `buildIdGateAck({confirmed})`, snapshot = `null`
   - Insert failures are logged and swallowed — they must not block the pipeline event below
3. Send the existing `pipeline/id-confirmed` Inngest event — unchanged.
4. If no row came back (gate already resolved — duplicate call), skip step 2 entirely; step 3 is unchanged from current behavior.
5. This route already uses a service-role Supabase client (bypasses RLS) for the status update — the same client is reused for the three inserts, consistent with existing behavior in this route.

**`POST /api/pipeline/confirm-gender`**

1. Fetch the listing row by id (`status, brand, category, condition, condition_notes, intake_meta`). This route currently has no gate-status guard at all.
2. If `status !== 'gender_gate'`, skip the conversation writes (new duplicate-call guard — small added safety net, not a behavior change to pipeline dispatch).
3. If it matches, insert three `conversations` rows in order:
   - `assistant`: `buildGenderGatePrompt(listing)` → `{ message, detailGateContext }`, snapshot = the `detailGateContext` fields
   - `user`: `synthesizeGenderGateAnswer({gender, measurements, detailGateContext})` from the request body, snapshot = `{gender, measurements}`
   - `assistant`: `buildGenderGateAck()`, snapshot = `null`
   - Insert failures logged and swallowed, same as above
4. Send the existing `pipeline/gender-confirmed` Inngest event — unchanged.
5. This route uses the authenticated user-session Supabase client (already required — it 401s without a signed-in user). `conversations` RLS (migration `0002`) scopes inserts to `listing_id IN (SELECT id FROM listings WHERE user_id = auth.uid())`, so this only succeeds for listings the caller owns — no extra ownership check needed in the route itself, the database enforces it.

**`ListingCard`'s dashboard "✓ Yes" button** already `POST`s to `/api/pipeline/confirm-id` with `{listingId, confirmed: true}` — no client changes needed; it gets the full three-row exchange for free since persistence lives in the route.

---

## Error Handling

Conversation-row inserts are best-effort: any Supabase insert error is logged (not thrown) and the route proceeds to send its Inngest event and return `{ ok: true }` as it does today. A logging/history failure must never block the listing from advancing through the pipeline — that's the one behavior this spec explicitly will not change.

---

## Testing

The repo has no existing test coverage or Supabase-mocking harness for API routes — only pure-function tests for platform adapters (`node --import tsx --test src/**/*.test.ts`). This spec follows that same pattern:

- Unit tests for every function in `gate-messages.ts` (prompt text for representative listings, snapshot shape, answer synthesis for both id_gate paths and gender_gate with/without measurements, both ack variants) — TDD, red before green.
- Route wiring (the actual DB inserts and guards) is verified manually against the real dev Supabase instance: trigger a gate confirmation, `psql` the `conversations` table directly, confirm all three rows landed in order (prompt → answer → ack) with correct `role`/`content`/`created_at`. No new test infrastructure is introduced for this — consistent with the rest of the codebase.

---

## Explicitly Out of Scope

- **No backfill.** No historical prompt data exists to backfill from (`conversations` had exactly 2 unrelated rows before this feature) — this is forward-only from the first gate confirmed after deploy.
- **No live in-session UX change.** `AgentChat` still won't show a "user" bubble for measurements mid-session during `handleMeasurementsSubmit` (the form just disappears today) — the row will be present on the *next* page load, which is the actual goal (persisted scrollback), not live-session echo.
- **The mid-flow transitional message is not persisted as its own row.** For categories needing both gender and measurements, the live UI shows a fourth, purely client-side beat between the gender pick and the measurement form: "Got it — now I need a few measurements. Fill these in and hit Continue." This happens entirely in `AgentChat.tsx` state with no API call to hook a write into (the actual `confirm-gender` request only fires once, after measurements are submitted, bundling gender + measurements together). Persisting it would require a new round trip for a purely transitional message. Skipped — the combined `user` answer row (gender + measurements) already carries the same information, just as one row instead of two live turns.
- **Metric/imperial measurement units.** Raised during this brainstorm but scoped out — tracked separately as `ai-listings-4zx`, to be brainstormed as its own spec after this ships. `synthesizeGenderGateAnswer`'s measurement formatting will need a small follow-up edit when that lands.
- **Other unpersisted `in_loop` prompts (photos-confirmed, auth-checklist, inclusions, final review) have the exact same underlying bug** — they're regenerated fresh via other branches of `buildWorkspaceContext()`/`inLoopContext()` and never written to `conversations` either. The original bd issue (`ai-listings-x9e`) scoped this work to `id_gate`/`gender_gate` specifically, so this spec does not touch them. Flagged as a candidate follow-up, not filed yet — see note to Joe below.
