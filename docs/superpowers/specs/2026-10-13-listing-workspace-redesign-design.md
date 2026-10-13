# Listing workspace redesign

Issue: ai-listings-7o0 · Prototype: [assets/2026-10-13-workspace-prototype.html](assets/2026-10-13-workspace-prototype.html) (open it in a browser; it uses OT-0006's real data and the Tailwind classes this repo uses).

## Why

The listing detail page (`src/app/listings/[id]/page.tsx`) wastes the first screen. The main photo is a full-width square with empty bars above and below. The chat permanently takes 40% of the width. The fields scroll underneath the photo. The checklists (status, photo plan, authentication, inclusions) are long one-item-per-row lists. On top of that:

- The status timeline is often wrong. Several non-adjacent steps show as active at once, and the order doesn't match the real pipeline.
- Adding studio photos means dragging them into the chat, waiting for previews and pressing Enter.

Joe wants more information visible without scrolling, and wants common actions done directly in the page instead of through the agent chat.

## Goals

- More useful content above the fold at a typical 1512×900 window.
- A status timeline that shows the real pipeline in the real order, with at most one active step.
- Studio photos uploaded straight from the page by click-to-browse (multi-select) or drag and drop.
- The same status badge, with the same colors, on the dashboard and the detail page, so "waiting on me" listings stand out.
- Condition and copy reviewed once, after the photo shoot, instead of twice.

## Non-goals

- No change to the agent chat's behavior or prompts beyond its container.
- No new platforms on the publish page.
- No mobile-specific layout work. Below the `lg` breakpoint the page can stack columns the way it does today.
- The photo-plan refresh bug (ai-listings-c6k) is tracked separately and not part of this work.

## Anti-goals

- The chat must not hide a waiting agent question. A collapsed chat with an unseen message has to be obvious.
- No component library (shadcn, Radix). The repo hand-rolls its UI with Tailwind v4, lucide-react and @dnd-kit; keep doing that.
- Don't lose existing behavior while moving things around: thumbnail drag-to-reorder, per-photo hover actions, the intake-photo fallback, the price override controls and the comps drawer.

## Workspace layout (detail page)

Match the prototype. At the `lg` breakpoint and up, the page is a four-track grid: photo column, divider, fields column, chat.

### Photo column

- Default width 600px. A 6px divider between the photo and fields columns can be dragged between 320px and 60% of the window width. Double-click resets it to 600px. Save the width in `localStorage`, per browser.
- Main image: no forced square. The box takes the photo's own aspect ratio (`w-full h-auto`, capped at about 65vh), so there are no empty bars. Keep the photo-type badge and the "n / N" counter.
- Thumbnails: a grid instead of a horizontal scroll strip, `repeat(auto-fill, minmax(80px, 1fr))`. That's 6 columns of about 88px at 600px wide, and it reflows when the divider moves. Keep @dnd-kit reordering, the selected-photo outline, and the rotate, background-removal and delete hover buttons (`PhotoPanel.tsx` `SortableThumbnail`).
- Intake photo: keep today's rule (`PhotoPanel.tsx:134-139`). With only the intake photo, show it alone, with no thumbnails. Once any studio photo exists, hide the intake photo completely.
- Upload: the last tile in the grid is an "Add photos" tile with a dashed border. Clicking it opens a file picker (`accept="image/*" multiple`). Dropping image files anywhere on the photo column shows an overlay and uploads them. With only the intake photo, show the same drop zone as a wide box under the image. Uploads go through the existing `POST /api/studio-upload` one file at a time, which already starts background removal and the quality gate. Move the upload loop out of `AgentChat.tsx` (around lines 190-210) into a shared helper that both the chat and the photo column call, so chat drag-and-drop keeps working. Show a pending tile with a spinner for each file while it uploads, then refresh.
- Below the thumbnails: the "Skip BG removal" toggle, then the price card (moved here from the fields column). The price card keeps everything it has today: price, confidence, price-to-move, the override controls and "View N comps".
- "View N comps" opens the existing `EvidenceDrawer`, which is a fixed overlay from the right, 512px wide. Leave it there. It covers the fields and chat while the photos and price card stay visible next to it.

### Fields column, top to bottom

1. SKU and status badge, then the title. Remove the brand line under the title. The title already falls back to the brand when there's no title.
2. The status block and a tabbed block side by side (`grid-cols-[220px_minmax(0,1fr)]`):
   - Status (always visible): see "Status timeline" below.
   - Tabs, in this order: Inclusions, Authentication, Photo Shoot. Each tab shows a count (for example "Photo Shoot 9/15"). Hide the Authentication tab when the listing isn't luxury or has no auth plan. The content area has a fixed max height and scrolls inside the block.
3. Details: one two-column label/value list, in this order: Category, Condition, Condition notes (full text), Description (full rendered markdown, plus "Ask the agent to rewrite if needed."), Measurements. Show only fields that have values. The condition-gate and copy-review panels (`ConditionReviewPanel`, `CopyReviewPanel`) still appear in place when their status is active.
4. Measurements show under one label, with the category's subfields on one line. For handbags that's Length, Width, Height. See "Measurements" below.
5. Keep auto-discount, the finalizing checklist and the agent-blocked banner. Place them where they fit; their position is the builder's call.

### Tabs content

- Inclusions: a list in the same style as the other tabs. Keep today's color rules (`FieldsPanel.tsx:645-701`):
  - Detected but unconfirmed: amber row with confirm (✓) and remove (✕) buttons.
  - Added by you: blue check, "added by you", counts as verified.
  - Detected and confirmed: green check.
  - Keep the tag-state and doc-source suffixes.

  Remove the separate suggestion chips. Replace the add input with a combobox:
  - Clicking or focusing the empty input lists about 4 common items for the category (`getInclusionChecklist` in `src/lib/inclusions.ts`, minus items already present).
  - Typing filters a list of all known checklist items across categories and highlights the match.
  - ↑/↓ move the highlight, Enter adds the highlighted item, Esc closes the list.
  - The last option is always "Add '<typed text>'" so free text still works.
  - Use the ARIA combobox pattern (`role="combobox"`, `listbox`, `aria-expanded`, `aria-selected`).
- Authentication: a progress bar with "x/y complete", then one row per step. Each row has the clickable status icon (pending → done → failed, as today), the step name, and the guidance text always visible underneath it. Keep the `Skip — I know it's authentic` button.
- Photo Shoot: one row per shot with the order number, a checkbox, the shot name, a HERO/required/optional tag, and the description always visible underneath. Show this tab at every status; today the photo plan disappears once photos are confirmed. The checkbox has three states:
  - Empty: not taken. Clicking marks it taken.
  - Blue: the user marked it taken. Clicking clears it. Save the change.
  - Green: verified by the photo quality check. It's locked and can't be clicked, and a tooltip says why.

### Chat

- Collapsed by default to a 44px rail on the right with a chat icon and a vertical "Agent chat" label. Clicking the rail opens it.
- Open: a header with a collapse button, then the existing `AgentChat` contents. A 6px divider on its left edge can be dragged to resize the chat between 320px and 55% of the window, so long agent replies don't wrap badly. Double-click resets it to 380px. Save the open/closed state and the width in `localStorage`.
- Unread badge: while the chat is collapsed, each new assistant message raises a count shown as a small green bubble on the rail. The bubble pops and pulses briefly when the count changes. Opening the chat clears the count. A gate question (ID, gender, detail gates) counts as a new message, so a waiting question is always visible.

## Status timeline

Rewrite `src/components/workspace/PipelineTimeline.tsx` to build one ordered list of steps. For each step, work out whether it's done from the listing and its photos. The first step that isn't done is the only active one. Steps after it show as pending, even if their own "done" condition happens to be true (unless they really are done; see below). This replaces today's per-step `ready` flags, which are why several steps spin at once.

Order for a luxury listing (non-luxury drops Auth Plan and uses "Inclusions" for step 7):

| # | Label | Sublabel | Done when |
|---|---|---|---|
| 1 | Product ID | Identified item from photo | `pipeline_step >= 1` |
| 2 | Vision Analysis | Condition, brand, inclusions, shot list | `pipeline_step >= 2` |
| 3 | Confirm ID | You confirm the identified item | the listing has left `id_gate` and the ID was confirmed |
| 4 | Pricing Research | Market comparables | `pipeline_step >= 3` |
| 5 | Draft Listing | Description, tags, platform fields | `pipeline_step >= 4` |
| 6 | Auth Plan | Authentication checklist | `pipeline_step >= 5` |
| 7 | Inclusions + Auth | Confirm box contents, run checklist | every inclusion confirmed and every auth step done |
| 8 | Photo Shoot | Take and upload the planned shots | at least one studio photo |
| 9 | Background Removal (or "Keep Original Backgrounds" when skipped) | Auto-processed after upload | every studio photo processed (`studioPhotosReady`) |
| 10 | Quality Check | Scans for blur, exposure, framing | see "Re-checking photos added later" |
| 11 | Condition Review | Grade confirmed from studio photos | `condition_confirmed` |
| 12 | Copy Review | Approve the rewritten description | `copy_approved_at` is set |
| 13 | Finalize | Package size and weight | status is `finalizing` or later |
| 14 | Publish | List on eBay and Poshmark | status is `published` (label reads "Published" once done) |

Gate steps that don't apply to a category (the gender/details gate) are left out rather than shown as done. Steps 7 and 8 aren't enforced in order by the backend, so a later step can be done while an earlier one isn't; show those later steps as done (checked) but never active. There's never more than one active step.

Visual style stays as today:
- Done: green check, gray text.
- Active: blue spinner (`Loader2`), blue text, its sublabel shown, and a light blue row highlight.
- Pending: hollow circle, dim text.
- Done and pending steps show a single line with the sublabel as a tooltip.
- Connector lines run between the icons.

Below the steps, once published, show "Live:" with links from `listing_urls`.

## Remove the early condition and copy review

Today the intake pipeline ends by setting `status: 'condition_gate'` (`intake-pipeline.ts:215-222`). That makes the user grade condition and approve copy from the intake photo, then do both again after the studio photos (`condition-reassessment.ts` puts the listing back to `condition_gate`, and `description-rewrite.ts` goes to `copy_review`). Remove the first pass:

- At the end of the pipeline, set `status: 'in_loop'` with `condition_confirmed: false` instead of `condition_gate`. Apply the same change wherever else a pipeline finishes into `condition_gate`; check `text-intake-pipeline.ts` and `resume-pipeline.ts`.
- The post-photo path stays as it is: photos confirmed → reassessment → `condition_gate` → confirm → `description-rewrite` → `copy_review` → approve → `in_loop`.
- Check that `StatusBadge`, `gate-messages.ts`, the agent system prompt and `ListingCard` don't assume a pre-photo `condition_gate`.
- Condition can only be confirmed once studio photos are confirmed (Joe's decision). Hide the inline amber condition-approve panel (`FieldsPanel.tsx:518-545`) until `photos_confirmed` is true. Have `PATCH /condition` and `confirm-condition` reject requests while `photos_confirmed` is false. Text-intake listings and anything that has only the intake photo can't finalize until studio photos are uploaded.
- Add a `copy_approved_at timestamptz` column. `approve-copy` sets it, and `description-rewrite` clears it when it starts a new rewrite. Step 12 and the "Finalize" badge read this column instead of inferring approval from `in_loop` plus `condition_confirmed`.
- One-off SQL migration for listings that haven't confirmed photos yet (`photos_confirmed = false`, status not `published`, `sold` or `archived`): set `condition_confirmed = false` and `copy_approved_at = null`, and move any in `condition_gate` or `copy_review` to `in_loop`. Their early confirmation came from the intake photo and gets redone after the photo shoot anyway. Listings with confirmed photos are left alone; backfill `copy_approved_at = updated_at` for those already past copy review.

### Re-checking photos added later

Today `batch-quality-check` and `condition-reassessment` fire only on `listing/photos-confirmed`, which happens once. `autoConfirmPhotosIfComplete` (`photo-quality-gate.ts:44-62`) flips `photos_confirmed` as soon as every photo uploaded *so far* is processed. With a one-file-at-a-time uploader, that can fire partway through a batch.

- Auto-confirm must wait for the upload batch to finish. Debounce `studio/uploaded` per listing in Inngest (about 30s with no new uploads), then check readiness.
- Add `quality_checked_at timestamptz` to listings, set every time `batch-quality-check` completes (pass or fail). Step 10 is done when `photos_confirmed`, `quality_checked_at` is newer than the last studio upload, and no `quality_failed` photos remain.
- Studio photos added after the first confirmation re-run `batch-quality-check`, using the same debounce, so new shots can be verified. Condition reassessment does not re-run on later uploads.

## Status badge

`src/components/dashboard/StatusBadge.tsx` is already shared by the dashboard (`ListingCard.tsx`) and the detail page (`FieldsPanel.tsx`). Change the mapping there only. Colors:

| Color | Labels |
|---|---|
| Gray | Processing, Archived |
| Amber | Every "waiting on you" state, each naming the task (see the next table) |
| Blue | Ready to publish (`finalizing`) |
| Emerald | Published to some platforms (for example "Published 1/2") |
| Purple | Published to all platforms |
| Dark green | Sold |

Amber labels, one per task:

| Situation | Label |
|---|---|
| `id_gate` | Confirm ID |
| `gender_gate`, gender not yet chosen | Pick gender |
| `gender_gate`, gender chosen (or not needed), measurements pending | Add measurements |
| `agent_blocked_kind = 'photo_quality'` (from `batch-quality-check.ts`) | Retake photos |
| `agent_blocked_kind = 'intake_failed'` (from `intake-pipeline.ts:58`, `text-intake-pipeline.ts:207`) | Intake failed |
| `agent_blocked_kind = 'rewrite_failed'` (from `description-rewrite.ts:36`) | Rewrite failed |
| pipeline done, no studio photos yet | Needs photos |
| `condition_gate` | Check condition |
| `copy_review` | Review copy |
| `copy_approved_at` set, status `in_loop` | Finalize |

Add an `agent_blocked_kind text` column (null when not blocked) and set it at each of the four places that set `agent_blocked: true` today. Clear it wherever `agent_blocked` is cleared. Backfill existing blocked rows from context: flagged photos mean `photo_quality`; `condition_gate` or `copy_review` means `rewrite_failed`; anything else means `intake_failed`. The badge reads the column; it never parses `agent_blocked_reason`.

"All platforms" means every platform on the publish page (`PlatformTabs`: eBay and Poshmark today), worked out from `listing_urls`. All amber labels share the one amber style so they stand out together. `id_gate` currently shows a gray "Processing" badge; that changes to amber.

## Publish page

- Rename the user-facing "Export" to "Publish": the header link in `src/app/listings/[id]/page.tsx:264-266` ("Export →" becomes "Publish →") and the breadcrumb in `src/app/listings/[id]/publish/page.tsx:51` ("Publish Export"). Code comments can stay.
- In `src/components/publish/PlatformTabs.tsx`, collapse each platform's fields card (eBay around line 216, Poshmark around line 289) by default. Its header gets a chevron toggle (lucide `ChevronRight`/`ChevronDown`, same pattern as `EvidenceDrawer.tsx:410-424`). Keep the Post button, "Copy all" and the manual-URL fallback visible while the card is collapsed.

## Measurements

Everything with physical dimensions uses length × width × height, in that order: input prompts, the details list, generated descriptions and platform fields. Clothing and ring/bangle/necklace measurements aren't box dimensions and keep their own fields.

- Generic dimension fields (`genericDimensionFields`, `src/lib/utils.ts:35-39`) cover handbag, small_leather_goods, electronics, keyboards, collectibles, watches, other, and jewelry without dedicated fields. The stored keys stay `width`, `height` and `depth`, so there's no data migration. Change only the labels, hints and order: `width` becomes Length ("side to side at the widest point"), `depth` becomes Width ("front to back"), `height` stays Height ("base to top"), listed in that order. This also changes the measurement-gate inputs, which read the same field list.
- Sneakers already store `item_length_in`, `item_width_in` and `item_height_in`. Show the size fields (`shoe_size_system`, `shoe_size_raw`, `us_size`) first, then L × W × H.
- Grep for every other place that labels these values and switch it to L × W × H. That includes the draft-listing/description prompts (descriptions currently say `9.84" W × 6.69" H × 2.76" D`), platform item specifics, and the shipping-box estimate in `measurements.estimated_shipping_box`.
- In the details list, measurements show under one Measurements label, with the populated subfields on one line, using `formatMeasurementValue` (`src/lib/units.ts`).

There's no belt category today, so belts use the generic fields until one exists.

## Per-shot photo status (backend)

Nothing stores per-shot progress today. `PhotoShot` (`types/listings.ts:88-95`) has no status, and nothing maps photos to shots.

- Add `status?: 'pending' | 'taken' | 'verified'` to `PhotoShot`, stored inside the existing `photo_plan` JSON. A missing value means `pending`.
- Add a small route to set a shot to `taken` or `pending`. It must refuse to change a shot that is `verified`.
- Extend the single vision call in `batch-quality-check.ts` so it also receives the shot list and returns, for each photo, which shot index it shows (or none). A shot becomes `verified` when a photo that passed the quality check matches it. Photos that fail don't verify anything. Never downgrade a `verified` shot.
- Don't add a second model call for this.

## Constraints

- Next.js 16 in this repo has breaking changes from older versions. Read `node_modules/next/dist/docs/` before touching routing or server components.
- Tailwind v4, lucide-react and @dnd-kit are already installed. Don't add new UI dependencies; native `<input type="file">`, pointer events for the dividers, and `localStorage` wrapped in try/catch are enough.
- Database changes are SQL files in `supabase/migrations/`, applied with `kubectl exec -i`, per AGENTS.md.

## Left to the builder

- Component boundaries and file layout. `FieldsPanel.tsx` is large, and splitting out the tabs block and the details list is encouraged.
- Exact breakpoint behavior below `lg`.
- Where auto-discount, the finalizing checklist and the agent-blocked banner sit in the fields column.
- How the "Confirm ID" step's done-state is derived (whatever the confirm-id route leaves behind).
- How the chat counts unread messages (it can compare assistant message count against what was seen while open).

## Calls made without Joe's explicit sign-off

- The exact wording of each amber label (Pick gender, Add measurements, Retake photos, Intake failed, Rewrite failed, Needs photos, Finalize).
- "Needs photos" and "Finalize" are new amber badges for the two `in_loop` waiting states. Today both show a green "Ready".
- "All platforms" for the purple badge means eBay and Poshmark, the platforms on the publish page.
- Later studio uploads re-run the quality check and shot verification, but not condition review.
- In-progress listings without confirmed photos lose their intake-photo condition confirmation in the migration.
- New columns `copy_approved_at` and `quality_checked_at` replace status inference.
- The timeline's Inclusions + Auth step sits before Photo Shoot, but the backend doesn't enforce that order. Out-of-order completion shows as done steps after the active one, never as a second active step.
