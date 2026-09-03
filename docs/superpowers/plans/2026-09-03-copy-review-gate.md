# Copy Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a human-review gate after every description rewrite so bad copy never reaches `in_loop` unchecked.

**Architecture:** New `copy_review` pipeline status holds the listing after `description-rewrite` runs. `CopyReviewPanel` displays all copy fields for review. User either approves (→ `in_loop`) or requests a rewrite with corrective notes (→ re-runs `description-rewrite`, returns to `copy_review`). Prompt is fixed to eliminate key-value block anti-pattern.

**Tech Stack:** Next.js App Router (API routes), Inngest v3 multi-trigger, Supabase (PostgreSQL), React + Tailwind

**Spec:** `docs/superpowers/specs/2026-09-03-copy-review-gate-design.md`

## Global Constraints

- `copy_review` is the only new DB status — no new columns on `listings`
- `description-rewrite` Inngest function must always end at `copy_review`, never directly at `in_loop`
- `approve-copy` is the only path to `in_loop` from `copy_review`
- API routes follow the pattern in `src/app/api/listings/[id]/confirm-condition/route.ts` — auth via `createClient()`, admin writes via `getSupabaseAdmin()`, CAS guards on all status transitions
- UI panel uses amber-toned styling matching `ConditionReviewPanel`
- `pnpm tsc --noEmit` must pass clean (pre-existing test-file errors are exempt — do not introduce new ones)

---

### Task 1: DB migration + TypeScript type

**Files:**
- Create: `supabase/migrations/0021_copy_review_status.sql`
- Modify: `src/types/listings.ts:1-9`

**Interfaces:**
- Produces: `ListingStatus` includes `'copy_review'`; DB enum includes `copy_review`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0021_copy_review_status.sql
ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'copy_review';
```

- [ ] **Step 2: Apply to production**

```bash
kubectl exec -i -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0021_copy_review_status.sql
```

- [ ] **Step 3: Verify**

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c "\dT+ listing_status"
```

Expected: `copy_review` appears in the enum values.

- [ ] **Step 4: Add `'copy_review'` to the TypeScript union**

In `src/types/listings.ts`, replace lines 1-9:

```ts
export type ListingStatus =
  | 'intake'
  | 'id_gate'
  | 'gender_gate'
  | 'in_loop'
  | 'condition_gate'
  | 'copy_review'
  | 'finalizing'
  | 'published'
  | 'archived';
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -20
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_copy_review_status.sql src/types/listings.ts
git commit -m "feat(db): add copy_review listing status"
```

---

### Task 2: Fix rewrite prompt — no key-value blocks

**Files:**
- Modify: `src/lib/pipeline/rewrite-listing.ts` (the `Rules:` section of the prompt string, around line 162)

**Interfaces:**
- Consumes: nothing new
- Produces: prompt that no longer generates `**Style:**`/`**Collection:**`/`**Material:**` key-value blocks at the top of descriptions

- [ ] **Step 1: Find the rules section of the prompt**

```bash
grep -n "Rules:" src/lib/pipeline/rewrite-listing.ts
```

- [ ] **Step 2: Add the no-key-value-block rule**

Find this line in the prompt (near the end of the rules list):
```
- condition_notes: polished prose that merges AI photo observations with the condition notes above — no contradictions with the description
```

Add the following rule immediately after it:
```
- Do NOT open canonical_description or poshmark_description with a key-value specification block (Style:, Collection:, Material:, Hardware:, etc.) — start with a flowing prose paragraph that describes the piece naturally
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/rewrite-listing.ts
git commit -m "fix(prompt): prohibit key-value spec blocks in description openings"
```

---

### Task 3: Add `ListingRewriteRequestedEvent` to Inngest client

**Files:**
- Modify: `src/lib/inngest/client.ts` (append after `ListingConditionConfirmedEvent`)

**Interfaces:**
- Produces: `ListingRewriteRequestedEvent` type with `{ listingId: string; extraNotes: string }`

- [ ] **Step 1: Add the event interface**

In `src/lib/inngest/client.ts`, after the `ListingConditionConfirmedEvent` block, add:

```ts
// Fired from the copy-review UI when the user requests a re-run of the
// description rewrite with corrective instructions. Condition is already
// confirmed — this bypasses the condition gate entirely.
export interface ListingRewriteRequestedEvent {
  name: 'listing/rewrite-requested'
  data: {
    listingId: string
    extraNotes: string
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/inngest/client.ts
git commit -m "feat(inngest): add ListingRewriteRequestedEvent type"
```

---

### Task 4: Update `description-rewrite` Inngest function

**Files:**
- Modify: `src/lib/inngest/functions/description-rewrite.ts` (full rewrite)

**Interfaces:**
- Consumes: `ListingRewriteRequestedEvent` from Task 3, `ListingConditionConfirmedEvent` (existing)
- Produces: function advances listing to `copy_review` (not `in_loop`); `onFailure` reverts to correct status based on trigger event

- [ ] **Step 1: Replace the file contents**

```ts
import { inngest } from '../client'
import type { ListingConditionConfirmedEvent, ListingRewriteRequestedEvent } from '../client'
import { loadApiKeys, runRewriteListing } from '@/lib/pipeline/rewrite-listing'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

type TriggerEvent = ListingConditionConfirmedEvent | ListingRewriteRequestedEvent

export const descriptionRewrite = inngest.createFunction(
  {
    id: 'description-rewrite',
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.listingId' },
    onFailure: async ({ event }) => {
      const innerEvent = (
        event as unknown as { data: { event: TriggerEvent } }
      ).data.event
      const listingId = innerEvent.data.listingId
      if (!listingId) return

      // Revert to the status the listing was in when this function fired.
      // condition-confirmed path: listing was in condition_gate.
      // rewrite-requested path: listing was in copy_review.
      const revertStatus =
        innerEvent.name === 'listing/rewrite-requested' ? 'copy_review' : 'condition_gate'
      const extraUpdate =
        revertStatus === 'condition_gate' ? { condition_confirmed: false } : {}

      const supabase = getSupabaseAdmin()
      const { data: updated, error: revertError } = await supabase
        .from('listings')
        .update({
          agent_blocked: true,
          agent_blocked_reason: 'Copy rewrite failed after all retries — try re-confirming condition.',
          status: revertStatus,
          ...extraUpdate,
        })
        .eq('id', listingId)
        .eq('status', revertStatus)
        .select('id')
        .maybeSingle()
      if (revertError) {
        console.error(`[description-rewrite] onFailure: failed to set agent_blocked for listing ${listingId}`, revertError)
      } else if (!updated) {
        console.warn(`[description-rewrite] onFailure: zero rows updated for listing ${listingId} — may have transitioned away from ${revertStatus}`)
      }
    },
  },
  [
    { event: 'listing/condition-confirmed' },
    { event: 'listing/rewrite-requested' },
  ],
  async ({ event, step }) => {
    const { listingId, extraNotes } = (event as unknown as TriggerEvent).data

    await step.run('rewrite-listing', async () => {
      const apiKeys = await loadApiKeys(listingId)
      return runRewriteListing(listingId, apiKeys, extraNotes ?? '')
    })

    // Advance to copy_review (not in_loop) so the human can review before publishing.
    // CAS guard allows both entry-point statuses: condition_gate (first rewrite) and
    // copy_review (subsequent rewrites from the copy review panel).
    await step.run('transition-to-copy-review', async () => {
      const supabase = getSupabaseAdmin()
      const { data: updated, error } = await supabase
        .from('listings')
        .update({ status: 'copy_review', agent_blocked: false })
        .eq('id', listingId)
        .in('status', ['condition_gate', 'copy_review'])
        .select('id')
        .maybeSingle()
      if (error) {
        throw new Error(`description-rewrite: failed to advance listing ${listingId} to copy_review -- ${error.message}`)
      }
      if (!updated) {
        console.warn(`description-rewrite: zero rows updated advancing ${listingId} to copy_review — listing may be archived or concurrently transitioned`)
      }
    })

    return { ok: true, listingId }
  }
)
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -20
```

Expected: no new errors. The `triggers` → array form is valid Inngest v3 syntax.

- [ ] **Step 3: Commit**

```bash
git add src/lib/inngest/functions/description-rewrite.ts
git commit -m "feat(inngest): advance to copy_review gate instead of in_loop; add rewrite-requested trigger"
```

---

### Task 5: `approve-copy` API route

**Files:**
- Create: `src/app/api/listings/[id]/approve-copy/route.ts`

**Interfaces:**
- Consumes: `listing.status === 'copy_review'` (CAS guard)
- Produces: `PATCH /api/listings/[id]/approve-copy` → advances listing to `in_loop`; 200 on success, 409 if CAS fails, 401/404 on auth/not-found

- [ ] **Step 1: Create the route**

```ts
// src/app/api/listings/[id]/approve-copy/route.ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  // Verify ownership
  const { data: listing } = await supabase
    .from('listings')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })

  // CAS: only advance if still in copy_review
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'in_loop', agent_blocked: false })
    .eq('id', id)
    .eq('status', 'copy_review')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`approve-copy: DB error for listing ${id}:`, error)
    return Response.json({ error: 'Database error — please try again' }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ error: 'Listing is no longer in copy review' }, { status: 409 })
  }

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listings/[id]/approve-copy/route.ts
git commit -m "feat(api): add approve-copy endpoint"
```

---

### Task 6: `request-rewrite` API route

**Files:**
- Create: `src/app/api/listings/[id]/request-rewrite/route.ts`

**Interfaces:**
- Consumes: `listing.status === 'copy_review'` (guard), `{ extra_notes: string }` body
- Produces: `POST /api/listings/[id]/request-rewrite` → fires `listing/rewrite-requested` event; 202 on success

- [ ] **Step 1: Create the route**

```ts
// src/app/api/listings/[id]/request-rewrite/route.ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { extra_notes?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const extraNotes = (body.extra_notes ?? '').trim()
  if (extraNotes.length > 2000) {
    return Response.json({ error: 'extra_notes too long (max 2000 chars)' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify ownership + status
  const { data: listing } = await supabase
    .from('listings')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.status !== 'copy_review') {
    return Response.json({ error: 'Listing is not in copy review' }, { status: 409 })
  }

  await inngest.send({
    name: 'listing/rewrite-requested',
    data: { listingId: id, extraNotes },
  })

  return Response.json({ ok: true }, { status: 202 })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listings/[id]/request-rewrite/route.ts
git commit -m "feat(api): add request-rewrite endpoint"
```

---

### Task 7: `CopyReviewPanel` component

**Files:**
- Create: `src/components/workspace/CopyReviewPanel.tsx`

**Interfaces:**
- Consumes: `listing: Listing` prop; calls `PATCH /api/listings/[id]/approve-copy` and `POST /api/listings/[id]/request-rewrite`
- Produces: rendered panel shown when `listing.status === 'copy_review'`

The panel shows all copy fields (canonical + platform-specific from `listing.platform_fields`), an "Approve" button, and a "Rewrite with notes" expandable section.

- [ ] **Step 1: Create the component**

```tsx
// src/components/workspace/CopyReviewPanel.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import type { Listing } from '@/types/listings'

interface Props {
  listing: Listing
}

interface PlatformFields {
  ebay?: { title?: string; description?: string }
  poshmark?: { title?: string; description?: string }
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed bg-gray-900/60 rounded px-2 py-1.5">{value}</p>
    </div>
  )
}

export function CopyReviewPanel({ listing }: Readonly<Props>) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteNotes, setRewriteNotes] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [rewriteRequested, setRewriteRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pf = (listing.platform_fields ?? {}) as PlatformFields

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${listing.id}/approve-copy`, { method: 'PATCH' })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to approve — please try again')
      }
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setApproving(false)
    }
  }

  async function handleRequestRewrite() {
    setRequesting(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${listing.id}/request-rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_notes: rewriteNotes }),
      })
      if (res.ok) {
        setRewriteRequested(true)
      } else {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to request rewrite — please try again')
      }
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setRequesting(false)
    }
  }

  if (rewriteRequested) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 text-center text-amber-300 text-sm">
        Rewrite requested — check back in about a minute.
      </div>
    )
  }

  const loading = approving || requesting

  return (
    <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 space-y-4">
      <p className="text-sm font-medium text-amber-200">Review copy before approving</p>

      <div className="space-y-3">
        <Field label="Title" value={listing.title} />
        <Field label="Description" value={listing.description} />
        <Field label="Condition notes" value={listing.condition_notes} />
        {pf.ebay?.title && <Field label="eBay title" value={pf.ebay.title} />}
        {pf.ebay?.description && <Field label="eBay description" value={pf.ebay.description} />}
        {pf.poshmark?.title && <Field label="Poshmark title" value={pf.poshmark.title} />}
        {pf.poshmark?.description && <Field label="Poshmark description" value={pf.poshmark.description} />}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={loading}
          className="flex-1 py-2 text-sm font-semibold rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {approving && <Loader2 className="w-4 h-4 animate-spin" />}
          {approving ? 'Approving…' : 'Approve'}
        </button>

        <button
          type="button"
          onClick={() => setRewriteOpen((o) => !o)}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors"
        >
          Rewrite with notes
          {rewriteOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {rewriteOpen && (
        <div className="space-y-2">
          <textarea
            value={rewriteNotes}
            onChange={(e) => setRewriteNotes(e.target.value)}
            placeholder="What needs fixing? (e.g. 'remove the key-value block at the top, open with a flowing paragraph')"
            rows={3}
            disabled={loading}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors resize-y disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleRequestRewrite()}
            disabled={loading}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {requesting && <Loader2 className="w-4 h-4 animate-spin" />}
            {requesting ? 'Requesting…' : 'Submit rewrite'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/CopyReviewPanel.tsx
git commit -m "feat(ui): add CopyReviewPanel component"
```

---

### Task 8: Wire `CopyReviewPanel` into `FieldsPanel`

**Files:**
- Modify: `src/components/workspace/FieldsPanel.tsx` (import + render near line 508)

**Interfaces:**
- Consumes: `CopyReviewPanel` from Task 7, `listing.status === 'copy_review'`

- [ ] **Step 1: Add import**

Find the existing `ConditionReviewPanel` import in `FieldsPanel.tsx` and add `CopyReviewPanel` alongside it:

```ts
import { ConditionReviewPanel } from './ConditionReviewPanel'
import { CopyReviewPanel } from './CopyReviewPanel'
```

- [ ] **Step 2: Render the panel**

Find the block at line ~508:
```tsx
{listing.status === 'condition_gate'
  ? <ConditionReviewPanel listing={listing} />
  : listing.condition && !conditionConfirmed && (
```

Replace with:
```tsx
{listing.status === 'condition_gate'
  ? <ConditionReviewPanel listing={listing} />
  : listing.status === 'copy_review'
  ? <CopyReviewPanel listing={listing} />
  : listing.condition && !conditionConfirmed && (
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "test\.ts" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/FieldsPanel.tsx
git commit -m "feat(ui): render CopyReviewPanel when listing is in copy_review"
```

---

### Task 9: Deploy + smoke test

**Files:** none (deploy + DB ops only)

- [ ] **Step 1: Push and wait for deploy**

```bash
git push
```

Watch the GitHub Actions deploy at the repo's Actions tab. Wait for "Deploy to k3s" to complete (~3-4 min).

- [ ] **Step 2: Sync Inngest functions**

```bash
curl -sS -X PUT --fail http://localhost:8288/v1/sync  # or via port-forward if needed
```

Or confirm the deploy step already ran the PUT sync (it does, per the workflow).

- [ ] **Step 3: Revert OT-0025 for end-to-end test**

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c \
  "UPDATE listings SET status='condition_gate', condition_confirmed=false, agent_blocked=false, agent_blocked_reason=null WHERE sku='OT-0025';"
```

- [ ] **Step 4: Smoke test the full flow**

1. Open OT-0025 in the workspace
2. Confirm the condition review panel appears
3. Select Very Good → Rewrite & Confirm
4. Wait ~1 min for Inngest to run
5. Refresh — verify `CopyReviewPanel` appears showing all copy fields
6. Verify the description does NOT open with a key-value block (Style:, Collection:, etc.)
7. If description is good → click Approve → verify listing advances to `in_loop`
8. If description still has issues → click "Rewrite with notes" → enter instructions → Submit → wait → refresh → review again

- [ ] **Step 5: Verify in DB**

```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c \
  "SELECT sku, status, agent_blocked FROM listings WHERE sku='OT-0025';"
```

Expected after approval: `status=in_loop, agent_blocked=f`
