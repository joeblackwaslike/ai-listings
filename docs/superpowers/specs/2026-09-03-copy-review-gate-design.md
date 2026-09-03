# Copy Review Gate — Design Spec

**Date:** 2026-09-03  
**Status:** Approved

## Problem

After `description-rewrite` runs, copy advances directly to `in_loop` with no human review. Bad output (e.g. key-value blocks at the top of descriptions) goes live without any ability to catch it. The prompt also actively produces this pattern despite being told not to.

## Solution

1. Insert a `copy_review` gate after every description rewrite — listing pauses for human approval before advancing to `in_loop`.
2. Give the user a "Rewrite with notes" escape hatch to re-run the rewrite with corrective instructions without going back to the condition gate.
3. Fix the rewrite prompt to eliminate the key-value block anti-pattern.

---

## Status Flow

```
condition_gate
  → (user confirms condition)
  → [Inngest: description-rewrite]
  → copy_review          ← NEW GATE

copy_review
  → (user approves)
  → in_loop              ← existing final state

copy_review
  → (user requests rewrite with notes)
  → [Inngest: description-rewrite]
  → copy_review          ← loops back to gate
```

---

## Database

**Migration** (`supabase/migrations/0021_copy_review_status.sql`):
```sql
ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'copy_review';
```

No new columns. `agent_blocked` / `agent_blocked_reason` already cover failure state.

**TypeScript** — add `'copy_review'` to `ListingStatus` union in `src/types/listings.ts`.

---

## Inngest — `description-rewrite.ts`

**Triggers** (multi-trigger):
- `listing/condition-confirmed` — existing, from condition gate confirmation
- `listing/rewrite-requested` — new, from "Rewrite with notes" action

Both event payloads carry `{ listingId: string, extraNotes?: string }`.

**Step 1** (rewrite): unchanged — calls `runRewriteListing(listingId, apiKeys, extraNotes)`.

**Step 2** (status advance): change target from `in_loop` → `copy_review`:
```ts
.update({ status: 'copy_review', agent_blocked: false })
.in('status', ['condition_gate', 'copy_review'])   // CAS guard covers both entry points
```

**`onFailure`**: check `event.name` to revert to the correct status:
- `listing/condition-confirmed` → revert to `condition_gate`
- `listing/rewrite-requested` → revert to `copy_review`

Both set `agent_blocked: true` with the existing error message.

---

## API Routes

### `PATCH /api/listings/[id]/approve-copy`
- Validates `status === 'copy_review'` (CAS guard on UPDATE)
- `UPDATE listings SET status='in_loop', agent_blocked=false WHERE id=? AND status='copy_review'`
- Returns 200 on success, 409 if CAS fails (listing no longer in copy_review), 404 if not found

### `POST /api/listings/[id]/request-rewrite`
- Body: `{ extra_notes: string }` (max 2000 chars)
- Validates listing exists and `status === 'copy_review'`
- Fires `listing/rewrite-requested` event via `inngest.send({ name: 'listing/rewrite-requested', data: { listingId, extraNotes: extra_notes } })`
- Returns 202 immediately — Inngest handles the work async

---

## UI — `CopyReviewPanel`

Rendered in `FieldsPanel` when `listing.status === 'copy_review'` (replaces/alongside the existing condition-confirmed quick-approve banner — check that the conditions don't collide).

**Layout** (amber-toned panel matching the condition gate style):

```
[ Copy review — approve or request a rewrite ]

Canonical title
  [read-only value]

Canonical description
  [read-only, scrollable, rendered as plain text]

Condition notes
  [read-only]

eBay
  Title: [read-only]
  Description: [read-only, scrollable]

Poshmark
  Title: [read-only]
  Description: [read-only, scrollable]

[ Approve ]   [ Rewrite with notes ▼ ]
              ↳ (expands textarea for instructions)
                [ Submit rewrite ]
```

**State machine:**
- Default: shows all fields + two action buttons
- "Rewrite with notes" clicked: expands an instruction textarea below, "Submit rewrite" button appears
- After "Approve" POST succeeds: `router.refresh()`
- After "Submit rewrite" POST succeeds: show inline message "Rewrite requested — check back in ~1 minute" (no loading spinner needed since Inngest is async)
- `agent_blocked=true` on this listing: show amber error banner with the `agent_blocked_reason` and a "Try again" button (calls request-rewrite with empty notes)

---

## Prompt Fix — `rewrite-listing.ts`

Add to the rules section of the Claude prompt:
```
- Do NOT open with a key-value specification block (Style:, Collection:, Material:, Hardware:, etc.) — 
  start canonical_description and poshmark_description with a flowing prose paragraph describing the piece
```

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0021_copy_review_status.sql` | Add `copy_review` enum value |
| `src/types/listings.ts` | Add `'copy_review'` to `ListingStatus` |
| `src/lib/inngest/functions/description-rewrite.ts` | Multi-trigger, advance to `copy_review`, fix onFailure |
| `src/lib/pipeline/rewrite-listing.ts` | Add no-key-value-block rule to prompt |
| `src/components/workspace/CopyReviewPanel.tsx` | New component |
| `src/components/workspace/FieldsPanel.tsx` | Render `CopyReviewPanel` when `status === 'copy_review'` |
| `src/app/api/listings/[id]/approve-copy/route.ts` | New endpoint |
| `src/app/api/listings/[id]/request-rewrite/route.ts` | New endpoint |

---

## Post-deploy

After the gate is live, revert OT-0025 to `condition_gate` with `condition_confirmed=false` so it re-flows through the new gate:
```sql
UPDATE listings 
SET status='condition_gate', condition_confirmed=false, agent_blocked=false, agent_blocked_reason=null 
WHERE sku='OT-0025';
```
