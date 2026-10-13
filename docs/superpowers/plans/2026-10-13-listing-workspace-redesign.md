# Listing Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the listing detail workspace so more is visible above the fold, the status timeline and badges match the real pipeline, studio photos upload straight from the page, and condition and copy are reviewed once, after the photo shoot.

**Architecture:** Testable logic lives in pure `.ts` modules (badge, pipeline steps, publish gate, inclusion options, layout storage) that both the server routes and the React components import. Pipeline-order rules are enforced on the server. A single migration adds three columns, two `photo_plan` SQL functions and conservative backfills. The UI work splits `FieldsPanel.tsx` into focused components inside a new client-side workspace shell.

**Tech Stack:** Next.js 16.2 (read `node_modules/next/dist/docs/` before touching routing), React 19, Tailwind v4, lucide-react, @dnd-kit, Supabase (self-hosted, k8s), Inngest, `node:test` via `tsx`.

**Spec:** [docs/superpowers/specs/2026-10-13-listing-workspace-redesign-design.md](../specs/2026-10-13-listing-workspace-redesign-design.md). The prototype is at [docs/superpowers/specs/assets/2026-10-13-workspace-prototype.html](../specs/assets/2026-10-13-workspace-prototype.html); match its sizes and classes.

## Global Constraints

- No new UI dependencies (no shadcn/Radix). Native `<input type="file">`, pointer events and `localStorage` wrapped in try/catch.
- Tests are `node:test` + `node:assert/strict`, named `*.test.ts` next to the module, run with `npm test`. Only `.ts` files are collected, so put logic under test in `.ts` modules, not `.tsx`.
- Migrations are SQL files in `supabase/migrations/`. The next number is `0042`. Apply with `kubectl exec -i -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < file` (the `-i` is required). Production is the only database. Applying the migration for real needs Joe's explicit go-ahead (Task 14).
- Photo column default 600px, range 320px to 60% of the window; chat default 380px, range 320px to 55%; collapsed chat rail 44px; dividers 6px; double-click resets.
- Thumbnails `repeat(auto-fill, minmax(80px, 1fr))`; main image `w-full h-auto`, max about 65vh.
- Tab order: Inclusions, Authentication, Photo Shoot.
- Details order: Category, Condition, Condition notes, Description, Measurements.
- Dimensions everywhere are Length × Width × Height. Generic keys stay `width`/`height`/`depth`: `width` → Length, `depth` → Width, `height` → Height.
- Badge tones: gray (Processing, Archived), amber (every waiting-on-you task), blue (Ready to publish), emerald (published to some platforms), purple (published to all), dark green (Sold). "All platforms" = eBay and Poshmark.
- Amber labels: Confirm ID, Pick gender, Add measurements, Retake photos, Intake failed, Rewrite failed, Needs photos, Check condition, Review copy, Finalize.
- User-facing "Export" becomes "Publish". Code comments can stay.

## Review Focus

1. A listing with only the intake photo, or a text-intake listing with no photos: no thumbnails, a wide drop zone, timeline active at Photo Shoot (or Inclusions + Auth), badge "Needs photos", and finalize/publish return 409. Tests in Tasks 2, 3 and 4.
2. A shot toggled while an inclusion edit rewrites `photo_plan`: neither write loses the other's change, and `verified` never downgrades. SQL test in Task 1, call-site checks in Task 7.
3. Twenty photos uploaded in one go: background removal starts per photo immediately, auto-confirm and condition reassessment fire once after the batch, and the quality check runs once per batch. Test in Task 6.
4. Legacy rows after the migration: early `condition_gate`/`copy_review` without photos, and `finalizing` without photos or with unconfirmed inclusions, all land in `in_loop` and need review again. Dry-run assertions in Task 1.
5. `localStorage` unavailable (private window, blocked storage): the layout uses defaults and nothing throws. Test in Task 10.

---

### Task 1: Migration 0042 and types

**Files:**
- Create: `supabase/migrations/0042_workspace_redesign.sql`
- Create: `supabase/migrations/0042_workspace_redesign.check.sql` (dry-run assertions, run inside `BEGIN … ROLLBACK`)
- Modify: `src/types/listings.ts` (`Listing`, `PhotoShot` at :88-95)

**Interfaces:**
- Produces: columns `listings.copy_approved_at timestamptz null`, `listings.quality_checked_at timestamptz null`, `listings.agent_blocked_kind text null check (agent_blocked_kind in ('photo_quality','intake_failed','rewrite_failed'))`.
- Produces SQL: `update_photo_plan(p_listing_id uuid, p_plan jsonb) returns jsonb`. Writes `p_plan` with each shot's `status` copied from the stored shot of the same `shot` name, never downgrading `verified`, in one `UPDATE … RETURNING`.
- Produces SQL: `set_photo_shot_status(p_listing_id uuid, p_shot text, p_status text) returns jsonb`. Sets one shot's status atomically. Raises if the stored status is `verified` and `p_status` isn't `verified`.
- Produces TS: `type PhotoShotStatus = 'pending' | 'taken' | 'verified'`; `PhotoShot.status?: PhotoShotStatus`; `type AgentBlockedKind = 'photo_quality' | 'intake_failed' | 'rewrite_failed'`; and the three new `Listing` fields.

- [ ] Step 1: Write `0042_workspace_redesign.check.sql`. It seeds three temporary listings inside the transaction and asserts with `DO $$ … ASSERT … $$`:
  - `update_photo_plan` keeps `taken` and `verified` across a rewrite that drops the status fields.
  - `set_photo_shot_status(…,'pending')` on a `verified` shot raises.
  - The backfill moves an early `condition_gate` row without photos to `in_loop` with `condition_confirmed=false`.
  - A `finalizing` row with an unconfirmed inclusion lands in `in_loop` with `copy_approved_at` null.
  - A fully confirmed `in_loop` row with `pipeline_step >= pipeline_total` gets `copy_approved_at = updated_at`.
- [ ] Step 2: Run it before the migration exists: `kubectl exec -i … psql -U postgres -v ON_ERROR_STOP=1 < <(printf 'BEGIN;\n'; cat supabase/migrations/0042_workspace_redesign.check.sql; printf 'ROLLBACK;\n')`. Expected: FAIL, function `update_photo_plan` does not exist.
- [ ] Step 3: Write `0042_workspace_redesign.sql`:
  - Columns, the check constraint and both functions.
  - First, `CREATE TABLE listings_backup_0042 AS SELECT id, status, condition_confirmed, agent_blocked FROM listings`.
  - Backfills exactly as the spec's "Remove the early condition and copy review" section and badge section say:
    - Condition reset for unconfirmed-photo rows not in `finalizing`/`published`/`sold`/`archived`.
    - Conservative `copy_approved_at`.
    - Finalizing gate using condition plus every inclusion confirmed, plus no `quality_failed` photos.
    - `agent_blocked_kind` from context.
- [ ] Step 4: Run the dry run again with the migration prepended inside the same `BEGIN … ROLLBACK`. Expected: no errors, every ASSERT passes, ends with `ROLLBACK`.
- [ ] Step 5: Update the types. Run `npx tsc --noEmit`. Expected: clean.
- [ ] Step 6: Commit: `feat(db): migration 0042 for workspace redesign (not applied)`.

### Task 2: Status badge logic

**Files:**
- Create: `src/lib/listing-status.ts`, `src/lib/listing-status.test.ts`
- Modify: `src/components/dashboard/StatusBadge.tsx`; `src/app/dashboard/page.tsx` (add `listing_urls`, `copy_approved_at`, `agent_blocked_kind`, `gender`, `measurements` to the `select` at :18 if missing)

**Interfaces:**
- Produces: `type BadgeTone = 'gray' | 'amber' | 'blue' | 'emerald' | 'purple' | 'green'`
- Produces: `getStatusBadge(listing: BadgeListing, ctx: { hasStudioPhotos: boolean; needsGender: boolean; needsMeasurements: boolean }): { label: string; tone: BadgeTone }`, where `BadgeListing = Pick<Listing, 'status' | 'pipeline_step' | 'pipeline_total' | 'agent_blocked' | 'agent_blocked_kind' | 'copy_approved_at' | 'listing_urls' | 'gender'>`
- Produces: `PUBLISH_PLATFORMS = ['ebay', 'poshmark'] as const`
- Produces: `BADGE_TONE_CLASSES: Record<BadgeTone, string>` (amber: `bg-amber-900/60 text-amber-300`; the rest keep today's classes)

- [ ] Step 1: Write the tests, one per row of the spec's amber table plus the non-amber states:
  - `id_gate` → `{label:'Confirm ID', tone:'amber'}`.
  - `gender_gate` with `needsGender && !gender` → `Pick gender`; with gender set and `needsMeasurements` → `Add measurements`.
  - `agent_blocked_kind:'photo_quality'` → `Retake photos` (the same for `intake_failed`/`rewrite_failed`).
  - `in_loop`, `pipeline_step >= pipeline_total`, `!hasStudioPhotos` → `Needs photos`.
  - `in_loop` with `copy_approved_at` set → `Finalize`.
  - `in_loop` with `pipeline_step < pipeline_total` → `Processing`/gray.
  - `finalizing` → `Ready to publish`/blue.
  - `published` with `listing_urls {ebay}` → `Published 1/2`/emerald; with both → `Published`/purple.
  - `sold` → green; `archived` → gray.
  - `agent_blocked` wins over status.
- [ ] Step 2: `npm test`. Expected: FAIL, cannot find module `./listing-status`.
- [ ] Step 3: Implement `getStatusBadge` and use it in `StatusBadge.tsx` (keep the base classes `text-[10px] font-medium px-1.5 py-0.5 rounded-full`). Compute `ctx` from `getMeasurementFields` and the photos the dashboard and detail page already load.
- [ ] Step 4: `npm test`. Expected: PASS.
- [ ] Step 5: Commit: `feat(status): task-specific status badges shared by dashboard and workspace`.

### Task 3: Pipeline steps

**Files:**
- Create: `src/lib/pipeline-steps.ts`, `src/lib/pipeline-steps.test.ts`
- Modify: `src/components/workspace/PipelineTimeline.tsx` (render only)

**Interfaces:**
- Produces: `type StepState = 'done' | 'active' | 'pending'`; `interface PipelineStep { key: string; label: string; sublabel: string; state: StepState }`
- Produces: `buildPipelineSteps(listing: Listing, photos: Photo[]): PipelineStep[]`

- [ ] Step 1: Write the tests:
  - A luxury listing at each stage has exactly one `active` step, and it's the first not-done step.
  - Keys appear in the spec order: `product_id, vision, confirm_id, pricing, draft, auth_plan, inclusions_auth, photo_shoot, bg_removal, quality_check, condition_review, copy_review, finalize, publish`.
  - Non-luxury omits `auth_plan` and labels step 7 `Inclusions`.
  - Text intake (never in `id_gate`; detect from `intake_meta`) omits `confirm_id`.
  - `skip_background_removal` labels step 9 `Keep Original Backgrounds`.
  - Studio photos uploaded while inclusions are unconfirmed: `inclusions_auth` is active and `photo_shoot` is done, with no second active step.
  - Published: every step is done and the last label is `Published`.
  - `quality_checked_at` older than the newest studio photo's `created_at`: `quality_check` isn't done.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement. In `PipelineTimeline.tsx`:
  - Done and pending rows are one line with the sublabel as `title`. The active row shows the sublabel and gets `bg-blue-950/30`.
  - Keep today's icon and color classes.
  - When published, add "Live:" links from `listing_urls` below the steps.
- [ ] Step 4: `npm test`. Expected: PASS.
- [ ] Step 5: Commit: `fix(timeline): one ordered pipeline with a single active step`.

### Task 4: Publish gate and server enforcement

**Files:**
- Create: `src/lib/publish-gate.ts`, `src/lib/publish-gate.test.ts`
- Modify: `src/app/api/listings/[id]/condition/route.ts`, `confirm-condition/route.ts`, `finalize/route.ts`, `post-to-ebay/route.ts`, `post-to-poshmark/route.ts`, `publish/route.ts` (mark-published and manual URL)

**Interfaces:**
- Consumes: `isPricingGateUnlocked` (`src/lib/pipeline/pricing-adjust.ts:260`)
- Produces: `canConfirmCondition(l: Pick<Listing,'photos_confirmed'>): GateResult`
- Produces: `canFinalizeOrPublish(l: Pick<Listing,'photos_confirmed'|'condition_confirmed'|'inclusions'|'copy_approved_at'|'status'>, photos: Pick<Photo,'type'|'photoroom_meta'>[]): GateResult`
- Produces: `type GateResult = { ok: true } | { ok: false; reason: string }`

- [ ] Step 1: Write the tests:
  - No confirmed photos → `{ok:false}` with a reason mentioning photos.
  - Missing `copy_approved_at` → false.
  - An unconfirmed inclusion → false.
  - A `quality_failed` studio photo → false.
  - Everything satisfied → `{ok:true}`.
  - `canConfirmCondition` is false without confirmed photos.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement, then call it at the top of each route. Return `409` with `{ error: reason }`. Finalize keeps its `in_loop` status check, and the publish routes keep their existing status checks.
- [ ] Step 4: `npm test` and `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] Step 5: Commit: `feat(api): enforce photos → condition → copy → finalize/publish order`.

### Task 5: One review pass, copy approval, block kinds

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts` (:58, :215-222), `text-intake-pipeline.ts` (:207 and its end-of-pipeline status), `resume-pipeline.ts`, `description-rewrite.ts` (:28-40 and its start), `batch-quality-check.ts` (:132-138), `src/app/api/listings/[id]/approve-copy/route.ts`, every `agent_blocked: false` site (`approve-copy`, `photos/[id]/quality-override`, `resume-pipeline`, `retry-step`, `intake-pipeline`, `text-intake-pipeline`, `description-rewrite`, `photo-quality-gate`, `UploadZone.tsx`)
- Modify: `src/lib/pipeline/gate-messages.ts`, `src/lib/agent/system-prompt.ts`, `src/components/workspace/FieldsPanel.tsx:518-545` (hide the inline condition panel until `photos_confirmed`)
- Test: extend `src/app/api/pipeline/bulk-restart/route.test.ts`'s pattern into `src/lib/inngest/functions/pipeline-end-status.test.ts`, extracting `pipelineEndUpdate(totalSteps: number): Partial<Listing>` into `src/lib/pipeline/pipeline-end.ts`

**Interfaces:**
- Produces: `pipelineEndUpdate(totalSteps)` returns `{ status:'in_loop', condition_confirmed:false, pipeline_total: totalSteps, agent_blocked:false, agent_blocked_reason:null, agent_blocked_kind:null }`
- Produces: `blockedUpdate(kind: AgentBlockedKind, reason: string)` and `unblockedUpdate()` in `src/lib/pipeline/pipeline-end.ts`, used at every set and clear site

- [ ] Step 1: Write the tests:
  - `pipelineEndUpdate(5).status === 'in_loop'`, with no `condition_gate` anywhere in it.
  - `blockedUpdate('rewrite_failed','x')` sets all three blocked fields.
  - `unblockedUpdate()` nulls the kind and the reason.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement the helpers and switch every site to them:
  - `approve-copy` sets `copy_approved_at: new Date().toISOString()`.
  - `description-rewrite` sets `copy_approved_at: null` when it starts.
  - Grep for `'condition_gate'` and check nothing else assumes a pre-photo condition gate.
- [ ] Step 4: `npm test`, then `grep -rn "agent_blocked: true" src | grep -v test`. Expected: PASS, and only `pipeline-end.ts` matches.
- [ ] Step 5: Commit: `feat(pipeline): single post-photo review pass, copy_approved_at, agent_blocked_kind`.

### Task 6: Photo readiness after upload batches

**Files:**
- Create: `src/lib/inngest/functions/photo-readiness.ts`, `src/lib/inngest/functions/photo-readiness.test.ts`
- Modify: `photo-quality-gate.ts` (:43-65, :120-125: stop calling auto-confirm, emit `listing/studio-photo-processed`), `batch-quality-check.ts` (:74-80 trigger; set `quality_checked_at` on every completion), `src/lib/inngest/client.ts` (event types), `src/app/api/inngest/route.ts` (register)

**Interfaces:**
- Produces: events `listing/studio-photo-processed { listingId }` and `listing/studio-batch-ready { listingId, firstConfirmation: boolean }`
- Produces: `photoReadiness` Inngest function, `debounce: { key: 'event.data.listingId', period: '30s' }`
- Produces: `decideReadiness(listing: Pick<Listing,'photos_confirmed'>, photos: Pick<Photo,'type'|'processed_url'>[]): { confirmNow: boolean; batchReady: boolean }` (pure, in the same file)

- [ ] Step 1: Write the tests:
  - With unprocessed photos: `{confirmNow:false, batchReady:false}`.
  - Everything processed and not yet confirmed: `{confirmNow:true, batchReady:true}`.
  - Already confirmed and everything processed (a later upload): `{confirmNow:false, batchReady:true}`.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement. On `confirmNow`, run the existing auto-confirm update and emit `listing/photos-confirmed` (condition reassessment stays on that event). On `batchReady`, emit `listing/studio-batch-ready`. Move `batch-quality-check` to `listing/studio-batch-ready`.
- [ ] Step 4: `npm test` and `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] Step 5: Commit: `feat(photos): debounced batch readiness; quality check reruns per upload batch`.

### Task 7: Per-shot status through the SQL functions

**Files:**
- Modify (switch to `supabase.rpc('update_photo_plan', …)`): `src/app/api/listings/[id]/inclusions/route.ts:23-40`, `photo-plan/refresh/route.ts:41-47`, `src/lib/pipeline/step5-auth-plan.ts:121-127`, `src/lib/agent/tools.ts:318,354`, `src/lib/agent/oauth-agent.ts`, `src/lib/claude/oauth-backend.ts`, `src/lib/inngest/functions/text-intake-pipeline.ts` (any `photo_plan` update; the first insert in `step2-vision-analysis.ts` can stay a plain write)
- Create: `src/app/api/listings/[id]/photo-plan/shots/route.ts` (`PATCH { shot: string, status: 'taken' | 'pending' }` → `rpc('set_photo_shot_status')`; 409 when the shot is verified)
- Modify: `batch-quality-check.ts` (extend the single Sonnet call's prompt and parsed schema with `shot_index: number | null` per photo; call `set_photo_shot_status(…,'verified')` for passing photos with a match)
- Create: `src/lib/pipeline/shot-verification.ts`, `src/lib/pipeline/shot-verification.test.ts`

**Interfaces:**
- Consumes: the Task 1 SQL functions and the Task 6 event
- Produces: `shotsToVerify(plan: PhotoShot[], results: { passed: boolean; shot_index: number | null }[]): string[]` (shot names)

- [ ] Step 1: Write the tests:
  - Only passing photos with an in-range `shot_index` produce names.
  - Duplicates collapse.
  - Shots already `verified` are skipped.
  - An out-of-range index is ignored.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement and switch every writer. Then `grep -rn "photo_plan" src | grep -E "update\(|\.update" | grep -v test`. Expected: no direct whole-array writes remain apart from the step 2 insert.
- [ ] Step 4: `npm test` and `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] Step 5: Commit: `feat(photo-plan): per-shot status, atomic writes, verification from quality check`.

### Task 8: Length × Width × Height

**Files:**
- Modify: `src/lib/utils.ts:35-39` (`genericDimensionFields` labels, hints and order: `width` "Length" side to side at the widest point; `depth` "Width" front to back; `height` "Height" base to top), the sneaker field order (`:46-54`, size fields first), every prompt or formatter that writes `W × H × D` (grep `W ×\|× D\|depth` in `src/lib/pipeline`, `src/lib/agent`, `src/lib/platforms`), and the `estimated_shipping_box` labels
- Test: `src/lib/utils.test.ts`, `src/lib/units.test.ts`

**Interfaces:**
- Produces: `formatDimensions(m: Record<string, unknown>, fields: MeasurementField[]): string | null` in `src/lib/units.ts`, returning `9.84" L × 2.76" W × 6.69" H` for the OT-0006 values

- [ ] Step 1: Write the tests:
  - `getMeasurementFields('handbag', null, …)` keys come back in the order `['width','depth','height']` with labels `['Length','Width','Height']`.
  - `formatDimensions({width:9.84,height:6.69,depth:2.76}, …)` returns `'9.84" L × 2.76" W × 6.69" H'`.
  - Sneakers list the size fields before length/width/height.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement and update the prompt strings and formatters.
- [ ] Step 4: `npm test`. Expected: PASS.
- [ ] Step 5: Commit: `feat(measurements): L × W × H everywhere dimensions appear`.

### Task 9: Shared studio upload helper

**Files:**
- Create: `src/lib/photos/upload-studio-photos.ts`, `src/lib/photos/upload-studio-photos.test.ts`
- Modify: `src/components/workspace/AgentChat.tsx:190-210` (call the helper)

**Interfaces:**
- Produces: `uploadStudioPhotos(listingId: string, files: File[], startOrder: number, opts?: { fetchImpl?: typeof fetch; onProgress?: (done: number, total: number) => void }): Promise<string[]>`. It posts one file at a time to `/api/studio-upload` with fields `photo`, `listingId`, `displayOrder`, and throws `Error(body.error ?? 'Upload failed (status)')` on non-OK.

- [ ] Step 1: Write the tests with a fake `fetchImpl`:
  - Files are posted in order with `displayOrder` = `startOrder + i`.
  - `onProgress` is called after each file.
  - A 500 with `{error:'x'}` rejects with `'x'`.
  - Non-image files are skipped.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement and switch `AgentChat`.
- [ ] Step 4: `npm test`. Expected: PASS.
- [ ] Step 5: Commit: `refactor(photos): shared studio upload helper`.

### Task 10: Workspace shell (columns, dividers, chat rail, unread)

**Files:**
- Create: `src/components/workspace/WorkspaceShell.tsx` (client), `src/lib/workspace-layout.ts`, `src/lib/workspace-layout.test.ts`
- Modify: `src/app/listings/[id]/page.tsx:253-295` (render the shell with `photos`, `fields` and `chat` slots), `AgentChat.tsx` (add `onAssistantMessage?: (id: string) => void`; drop its own outer width assumptions)

**Interfaces:**
- Produces: `clampWidth(px: number, min: number, maxFraction: number, total: number): number`
- Produces: `readStoredNumber(key: string, fallback: number, storage?: Pick<Storage,'getItem'>): number` (never throws)
- Produces: `countUnread(messageIds: string[], lastSeenId: string | null): number`
- Produces: storage keys `ws.photoW`, `ws.chatW`, `ws.chatOpen`, `ws.lastSeen.<listingId>`

- [ ] Step 1: Write the tests:
  - `clampWidth(900, 320, 0.6, 1200) === 720`.
  - `readStoredNumber` returns the fallback when `getItem` throws, returns null, or returns `'abc'`.
  - `countUnread(['a','b','c'], 'a') === 2`.
  - `countUnread(ids, null) === ids.length`.
  - An unknown `lastSeenId` counts all.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement:
  - The grid template is `${photoW}px 6px minmax(0,1fr) ${open ? '6px ' + chatW + 'px' : '0px 44px'}`.
  - Both dividers stay in the grid, using `invisible` rather than `hidden` when the chat is closed.
  - Dividers use pointer capture, with a double-click reset.
  - Rail badge: green bubble, with `bump` and `ring` keyframes from the prototype on each change.
  - Opening the chat writes `lastSeen`.
  - Gate messages count as assistant messages.
  - Below `lg`, columns stack as today.
- [ ] Step 4: `npm test` and `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] Step 5: Commit: `feat(workspace): resizable photo/chat columns, collapsible chat with unread badge`.

### Task 11: Photo column

**Files:**
- Modify: `src/components/workspace/PhotoPanel.tsx` (main image without the square, thumbnail grid, add-photos tile, keep `SortableThumbnail` hover actions and @dnd-kit with `rectSortingStrategy`, keep the intake rule at :134-139), `PhotoSection.tsx` (drop overlay for the whole column, wide drop zone when only the intake photo exists, then the Skip BG toggle, then the price card)
- Create: `src/components/workspace/PriceCard.tsx` (moved verbatim from `FieldsPanel.tsx:405-495`, including the override controls and `EvidenceDrawer` trigger)

**Interfaces:**
- Consumes: `uploadStudioPhotos` (Task 9); `EvidenceDrawer` unchanged

- [ ] Step 1: Move the price card. Run `npx tsc --noEmit`. Expected: clean.
- [ ] Step 2: Implement the grid, upload tile and drop overlay. Accept only `image/*`. Show a spinner tile per pending file, then `router.refresh()`. The overlay uses `pointer-events-none` and a drag-depth counter.
- [ ] Step 3: Smoke test in `npm run dev` on OT-0006 and on a listing with only an intake photo:
  - Grid columns reflow while dragging the divider.
  - The upload tile opens a multi-select picker.
  - Dropping 2 images shows 2 spinner tiles, then real thumbnails.
  - The intake-only listing shows no thumbnails, just the wide drop zone.
- [ ] Step 4: Commit: `feat(workspace): photo grid, direct upload, price card in photo column`.

### Task 12: Fields column (tabs, combobox, details)

**Files:**
- Create: `src/components/workspace/ListingTabs.tsx`, `InclusionsTab.tsx`, `InclusionCombobox.tsx`, `AuthenticationTab.tsx`, `PhotoShootTab.tsx`, `DetailsList.tsx`; `src/lib/inclusion-options.ts`, `src/lib/inclusion-options.test.ts`
- Modify: `FieldsPanel.tsx` (becomes the composition: header without the brand line, then Status and tabs side by side `grid-cols-[220px_minmax(0,1fr)]`, then DetailsList, then auto-discount, the finalizing checklist and the blocked banner; drop the moved code)

**Interfaces:**
- Consumes: `buildPipelineSteps` (Task 3), `formatDimensions` (Task 8), the shots route (Task 7)
- Produces: `inclusionOptions(query: string, present: string[], category: string, subType: string | null): { value: string; custom?: true }[]`. Empty query: up to 4 from `getInclusionChecklist` not already present. Non-empty: case-insensitive substring over every known checklist item across categories, not present, max 8, then a `{value: query, custom: true}` option unless there's an exact match.

- [ ] Step 1: Write the tests:
  - `inclusionOptions('', ['Dust bag/cover'], 'handbag', null)` has length ≤ 4 and excludes the dust bag.
  - `'re'` matches `Receipt`, `Reseller tag/UPC` and `Warranty/registration card`, and ends with a custom option.
  - An exact match has no custom option.
  - `present` matching is case-insensitive.
- [ ] Step 2: `npm test`. Expected: FAIL.
- [ ] Step 3: Implement `inclusionOptions` and the components:
  - Combobox: ARIA combobox/listbox, ↑/↓/Enter/Esc, focus opens it.
  - Inclusion rows keep the colors at `FieldsPanel.tsx:645-701`.
  - Authentication: progress bar, status icon cycling as today, guidance always visible, keep the `Skip — I know it's authentic` button.
  - Photo Shoot: number, three-state box (empty / `bg-blue-500` taken / `bg-emerald-600` verified and locked with a tooltip), HERO/required/optional tag, description always visible. Shown at every status.
  - Hide the Authentication tab when the listing isn't luxury or has no `auth_plan`.
- [ ] Step 4: `npm test`, `npx tsc --noEmit`, then a dev-server smoke test on OT-0006. Expected:
  - Tab counts are correct.
  - The combobox works from the keyboard.
  - Toggling a shot saves and survives a reload.
  - A verified shot can't be clicked.
- [ ] Step 5: Commit: `feat(workspace): tabbed inclusions/authentication/photo shoot and details list`.

### Task 13: Publish page

**Files:**
- Modify: `src/app/listings/[id]/page.tsx:264-266` (`Publish →`), `src/app/listings/[id]/publish/page.tsx:51` (breadcrumb `Publish`), `src/components/publish/PlatformTabs.tsx` (eBay card ~:216, Poshmark ~:289)

- [ ] Step 1: Rename the labels. Wrap each fields card in a header button with `ChevronRight`/`ChevronDown` (pattern from `EvidenceDrawer.tsx:410-424`), collapsed by default. The Post button, "Copy all" and the manual-URL fallback stay outside the collapsed area.
- [ ] Step 2: `grep -rn ">Export\|Export →\|Publish Export" src`. Expected: no matches. Dev smoke test: the cards start collapsed and toggle open.
- [ ] Step 3: Commit: `feat(publish): rename Export to Publish, collapse platform fields by default`.

### Task 14: Verify, apply the migration, ship

- [ ] Step 1: `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] Step 2: Re-run the Task 1 dry run (`BEGIN … ROLLBACK`) against production. Expected: every assertion passes. Report the row counts the backfill would touch (run its `WHERE` clauses as `SELECT count(*)`) to Joe.
- [ ] Step 3: Stop and get Joe's explicit go-ahead to apply 0042 to production. Then apply it with `kubectl exec -i`, and check `SELECT count(*) FROM listings_backup_0042` matches `listings`.
- [ ] Step 4: Run `/no-mistakes` to push and open the PR (bd ai-listings-7o0 in the body), then drive it with `/pr-loop`. The deploy has to land with or after the migration, because the code reads the new columns.
