# Gate Conversation Persistence — Design Spec

**Date:** 2026-08-13
**Status:** Approved
**Derived from:** design conversation 2026-08-13, bd issue `ai-listings-x9e`

---

## What This Builds

The `id_gate` ("is this correct?") and `gender_gate` (gender/measurements) prompts shown in `AgentChat` and `ListingCard` are regenerated fresh every time from the listing's *current* status, via `buildWorkspaceContext()` in `src/app/listings/[id]/page.tsx`. Confirming a gate flips the listing's status column and moves on — nothing is written to the `conversations` table. Once a listing moves from `id_gate` to `gender_gate`, the earlier "is this correct?" exchange vanishes, replaced by an unrelated fresh prompt.

This spec adds real `conversations` rows whenever a gate is confirmed, so `AgentChat`'s `initialMessages` scrollback shows the whole intake conversation, gates included, on every future page load. Each exchange is three turns, matching what the live UI actually shows today: an `assistant` row for the generated prompt, a `user` row for the answer, and a trailing `assistant` row for the acknowledgment (e.g. "Confirmed! Running pricing research now…") that `AgentChat.tsx` currently only ever renders client-side and never persists.

**Done when:** confirming an `id_gate` or `gender_gate` (from either the detail-page chat or the dashboard-card fast path) writes the prompt, answer, and acknowledgment as three `conversations` rows, and reloading the listing detail page shows the full three-turn exchange in the chat history. Additionally: an `in_loop` listing that transitions between sub-states before any real chat message exists (e.g. background removal finishing unattended) has its prior greeting preserved as a single persisted `assistant` row, rather than silently replaced.

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
| `src/app/listings/[id]/page.tsx` | Modify | `idGateContext()`/`genderGateContext()` call the shared builders instead of inlining the text; also inserts the one-off `in_loop` first-message row when `!hasHistory` |
| `src/app/api/pipeline/confirm-id/route.ts` | Modify | Fetch listing, build + insert the prompt/answer/ack conversation rows before sending the existing Inngest event |
| `src/app/api/pipeline/confirm-gender/route.ts` | Modify | Guard on `status === 'gender_gate'`, build + insert the prompt/answer/ack conversation rows before sending the existing Inngest event |

No changes to `AgentChat.tsx`, `ListingCard.tsx`, or the Inngest pipeline function (`intake-pipeline.ts`) — the id_gate/gender_gate persistence lives entirely in the two API routes both entry points already call; the in_loop first-message write lives in `page.tsx` itself (see below), since there's no confirm-style route to hook it into.

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
4. If no row came back (gate already resolved — duplicate call), skip step 2 entirely; step 3 is unchanged from current behavior. This is indistinguishable, by data alone, from a genuine update failure (`.maybeSingle()` returns `data: null` for both) — the query's `error` is also logged (separately from the insert's own error logging) so a real failure is visible in production logs rather than silently collapsing into the same no-op path as the legitimate duplicate-call case.
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
- **Future structured gates should stay serial, not spread out over time.** If more bespoke-confirm-route gates (in the id_gate/gender_gate style) get added later, each one potentially triggering its own re-identification/vision-analysis call, they should be presented back-to-back in one sitting rather than left with long idle gaps (e.g. multi-day `step.waitForEvent` timeouts) between them, to avoid redundant lookups. No such project is scoped yet — recorded via `bd remember` for whenever one is.

### Correction: the other `in_loop` prompts do NOT have the same bug

An earlier pass through this spec claimed photos-confirmed/auth-checklist/inclusions/final-review prompts have "the exact same underlying bug" as `id_gate`/`gender_gate`. Tracing the actual code disproves that: `AgentChat`'s general chat path (`doSend` → `/api/agent/[listingId]` → `streamAgentResponse`, see `src/lib/agent/chat.ts`) already inserts both `user` and `assistant` rows into `conversations` on every real chat turn. Every suggestion in `inLoopContext` — including the photos "Looks good ✓" button (`confirmPhotos` doesn't `return` early in `handleSuggestionSelect`; it falls through to `doSend` like any generic suggestion) — ends up going through that path and is already persisted correctly. `id_gate`/`gender_gate` are the outliers specifically because `confirmId`/`confirmGender` `return` early and hit bespoke API routes (`confirm-id`/`confirm-gender`) that never touch `conversations` at all. There is no parallel "missed gates" cleanup needed for the rest of `inLoopContext`.

### In-loop first-message persistence (narrow gap closure)

One real, narrower gap remains, and is now in scope per Joe's request: because `firstMessage` is only ever shown when `messages.length === 0` (i.e. `hasHistory` is still false), a listing that transitions between `in_loop` sub-states (e.g. background removal finishing) purely from a background job — before the user has ever typed a real chat message — can still have an earlier greeting silently replaced by a new one on the next page load, with no trace left behind. This is much narrower than the id_gate/gender_gate bug (it only bites while `hasHistory` is false, and closes itself permanently the first time it's fixed, per the mechanism below), but it's the same class of issue, so it's being closed here.

**Fix:** in `WorkspacePage` (`page.tsx`), immediately after computing `buildWorkspaceContext`, if `!hasHistory && firstMessage && !listing.agent_blocked` and the status is `in_loop` specifically (not `id_gate`/`gender_gate`, which already get their own three-row treatment via the confirm routes, and not `intake`/other pre-`in_loop` statuses, which would otherwise have this write fire on the generic "I'm working on this listing..." placeholder and permanently prevent the real in-loop greeting from ever being shown or persisted — see the code review findings on the implementation PR), insert a single `assistant` row with `content = firstMessage`, `context_snapshot = null`. The `agent_blocked` exclusion matters because `buildWorkspaceContext` checks `agent_blocked`/`agent_blocked_reason` *before* the status branches — a listing can be `status: 'in_loop'` with `agent_blocked: true` (set by any pipeline step's `onFailure` handler) and have `firstMessage` be transient error text rather than the real in-loop greeting; persisting that would be the same permanent-placeholder bug again, reached through a different precondition.

This write is self-limiting by construction, not by an explicit dedup check: the moment it succeeds, `hasHistory` becomes true for this listing, and page.tsx's existing ternary (`!hasHistory || status === 'id_gate' || status === 'gender_gate'`) stops calling `buildWorkspaceContext` for `in_loop` entirely on every subsequent load — so there's nothing left to write, ever again, for that listing's `in_loop` phase. The one accepted risk: this is a DB write happening inside a Server Component render (a GET-shaped request gaining a side effect), and if `AutoRefresh` (which polls this page every 30s and on `visibilitychange` while the listing isn't `published`/`archived`) fires two overlapping requests before the first write lands, both could observe `hasHistory === false` and double-insert — and because each request independently re-fetches `listing`/`photos`, the two rows aren't guaranteed to be identical: if pipeline state changes between the two reads, the inserted rows can carry different, contradictory greeting text (e.g. "Background removal is running…" and "Your photos have been processed…" both landing as permanent rows, in whichever order the inserts happen to complete). Since the write is self-limiting, there's no later correction. Given this is a single-user app and the practical window is small, this is accepted rather than solved with a lock — consistent with the TOCTOU risk already accepted in the `confirm-gender` gate-status check above.

The guard itself is extracted as `shouldPersistInLoopGreeting(listing, hasHistory, firstMessage)` in `gate-messages.ts` (rather than left as an inline boolean expression in `page.tsx`) — it took three code-review rounds to land the correct condition (first too broad across non-`in_loop` statuses, then still catching `agent_blocked` listings), which is itself the argument for making it a named, independently unit-tested function rather than trusting inline logic and manual re-reads to catch a fourth case.
