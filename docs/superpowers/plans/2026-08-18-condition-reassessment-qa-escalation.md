# Condition Re-assessment + QA Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing dead-end photo quality gate into a self-resolving human escalation (checklist banner, per-photo Retake/Use-as-is, auto-clearing `agent_blocked`), and add condition re-assessment over the full studio-photo set once photos are confirmed, gated behind human approval before Finalize.

**Architecture:** Delete the duplicate `studio-photo-process.ts` Inngest handler first (it silently defeats the quality gate it races). Extend the `studio/uploaded` event with an optional `replacesPhotoId` that flows through a single execution, not a persisted column, so a retake's old photo is superseded exactly once its outcome is known. `agent_blocked` becomes this sub-project's sole responsibility from `in_loop` onward — cleared automatically by re-querying for outstanding `quality_failed` photos after every quality-gate run, never by a manual click. Condition re-assessment fires off the existing `photos_confirmed` checkpoint (not off raw background-removal completion) and uses one Claude call with all studio photos attached, requiring a small additive extension to the Claude call facade (`image?:` singular stays, `images?:` plural is new, both backends handle it).

**Tech Stack:** TypeScript, Next.js route handlers, Inngest step functions/events, Supabase (self-hosted k8s, service-role client for pipeline writes), `@anthropic-ai/sdk` / `@anthropic-ai/claude-agent-sdk` (via this repo's `src/lib/claude` facade).

**Note on scope:** This is sub-project 2 of 3 (bd `ai-listings-e75`). Pricing use of condition/inclusions (`ai-listings-yva`) is explicitly out of scope beyond the interim Finalize gate this plan adds — see the spec's "Explicitly Out of Scope" section. No unit test files are added in this plan: `src/lib/pipeline/**`, `src/lib/inngest/functions/**`, and every `.tsx` file in this repo have no test harness (all live I/O or React components with none anywhere in the codebase) — every task below verifies via `tsc`/`eslint` plus manual smoke, matching this repo's existing convention.

---

### Task 1: Delete the duplicate Inngest handler

**Files:**
- Delete: `src/lib/inngest/functions/studio-photo-process.ts`
- Modify: `src/app/api/inngest/route.ts`

- [ ] **Step 1: Delete the file**

```bash
git rm src/lib/inngest/functions/studio-photo-process.ts
```

- [ ] **Step 2: Remove its registration**

Current (`src/app/api/inngest/route.ts:1-21`):
```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'
import { studioPhotoProcess } from '@/lib/inngest/functions/studio-photo-process'
import { syncPlatformNotifications } from '@/lib/inngest/functions/sync-platform-notifications'
import { syncPlatformMessages } from '@/lib/inngest/functions/sync-platform-messages'
import { syncPlatformOrders } from '@/lib/inngest/functions/sync-platform-orders'
import { textIntakePipeline } from '@/lib/inngest/functions/text-intake-pipeline'
import { autoDiscountCron } from '@/lib/inngest/functions/auto-discount-cron'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    intakePipeline,
    retryStep,
    photoQualityGate,
    studioPhotoProcess,
    syncPlatformNotifications,
    syncPlatformMessages,
    syncPlatformOrders,
    textIntakePipeline,
    autoDiscountCron,
  ],
})
```

Replace with:
```ts
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'
import { syncPlatformNotifications } from '@/lib/inngest/functions/sync-platform-notifications'
import { syncPlatformMessages } from '@/lib/inngest/functions/sync-platform-messages'
import { syncPlatformOrders } from '@/lib/inngest/functions/sync-platform-orders'
import { textIntakePipeline } from '@/lib/inngest/functions/text-intake-pipeline'
import { autoDiscountCron } from '@/lib/inngest/functions/auto-discount-cron'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    intakePipeline,
    retryStep,
    photoQualityGate,
    syncPlatformNotifications,
    syncPlatformMessages,
    syncPlatformOrders,
    textIntakePipeline,
    autoDiscountCron,
  ],
})
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (in particular, no dangling import errors from the deleted file)

- [ ] **Step 4: Commit**

```bash
git add src/lib/inngest/functions/studio-photo-process.ts src/app/api/inngest/route.ts
git commit -m "fix(studio-photos): delete studio-photo-process.ts, superseded by photo-quality-gate.ts

Both handlers triggered on studio/uploaded and called removeBackground.
studio-photo-process.ts ran unconditionally (no quality check) and its
write resets photoroom_meta: {}, silently erasing whatever quality
verdict photo-quality-gate.ts wrote whenever it won the race.
photo-quality-gate.ts already calls removeBackground itself on its own
quality-pass branch -- the duplicate was dead weight, not a second
thing to coordinate with."
```

---

### Task 2: Event and Claude-call type plumbing

**Files:**
- Modify: `src/lib/inngest/client.ts`
- Modify: `src/lib/claude/types.ts`

- [ ] **Step 1: Extend `StudioUploadedEvent`, add `ListingPhotosConfirmedEvent`**

Current (`src/lib/inngest/client.ts:44-50`):
```ts
export interface StudioUploadedEvent {
  name: 'studio/uploaded'
  data: {
    listingId: string
    photoId: string
    photoUrl: string
  }
}
```

Replace with:
```ts
export interface StudioUploadedEvent {
  name: 'studio/uploaded'
  data: {
    listingId: string
    photoId: string
    photoUrl: string
    replacesPhotoId?: string
  }
}

export interface ListingPhotosConfirmedEvent {
  name: 'listing/photos-confirmed'
  data: {
    listingId: string
  }
}
```

- [ ] **Step 2: Add `images?:` to `StructuredCallParams`**

Current (`src/lib/claude/types.ts:14-31`):
```ts
export interface StructuredCallParams {
  model: string
  prompt: string
  /** JSON-schema-shaped object describing the desired structured output. */
  jsonSchema: Record<string, unknown>
  image?: ClaudeImageInput
  /**
   * Per-user/per-request API key. Ignored by the oauth backend. When
   * omitted, the api-key backend falls back to `process.env.ANTHROPIC_API_KEY`
   * (the underlying `@anthropic-ai/sdk` client's own default), matching the
   * pre-facade call sites that did the same via `new Anthropic({ apiKey })`.
   */
  apiKey?: string
  maxTokens?: number
  /**
   * Name of the forced tool used to elicit structured output from the
   * api-key backend. Each pre-facade call site used its own tool name
   * (e.g. `extract_product_info`, `generate_listing`) — preserved here
   * instead of a shared generic name so migration is a pure refactor.
   */
  toolName?: string
  /** Description of the forced tool. See `toolName`. */
  toolDescription?: string
}
```

Add `images?: ClaudeImageInput[]` immediately after `image?: ClaudeImageInput`:
```ts
export interface StructuredCallParams {
  model: string
  prompt: string
  /** JSON-schema-shaped object describing the desired structured output. */
  jsonSchema: Record<string, unknown>
  image?: ClaudeImageInput
  /** Multiple images in one call — used when a single judgment needs to see every photo at once. */
  images?: ClaudeImageInput[]
  /**
   * Per-user/per-request API key. Ignored by the oauth backend. When
   * omitted, the api-key backend falls back to `process.env.ANTHROPIC_API_KEY`
   * (the underlying `@anthropic-ai/sdk` client's own default), matching the
   * pre-facade call sites that did the same via `new Anthropic({ apiKey })`.
   */
  apiKey?: string
  maxTokens?: number
  /**
   * Name of the forced tool used to elicit structured output from the
   * api-key backend. Each pre-facade call site used its own tool name
   * (e.g. `extract_product_info`, `generate_listing`) — preserved here
   * instead of a shared generic name so migration is a pure refactor.
   */
  toolName?: string
  /** Description of the forced tool. See `toolName`. */
  toolDescription?: string
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors — these are additive/optional fields, no existing call site should break

- [ ] **Step 4: Commit**

```bash
git add src/lib/inngest/client.ts src/lib/claude/types.ts
git commit -m "feat(condition-qa): add replacesPhotoId, photos-confirmed event, and plural images param

Type-only plumbing: StudioUploadedEvent gains an optional replacesPhotoId
that flows through a single Inngest execution (no persisted column needed);
ListingPhotosConfirmedEvent is new; StructuredCallParams gains images?:
alongside the existing singular image?:, for the condition-reassessment
call that needs to see every studio photo at once."
```

---

### Task 3: Both Claude backends build N image blocks

**Files:**
- Modify: `src/lib/claude/api-key-backend.ts`
- Modify: `src/lib/claude/oauth-backend.ts`

- [ ] **Step 1: Extend `buildUserContent` in the api-key backend**

Current (`src/lib/claude/api-key-backend.ts:23-31`):
```ts
function buildUserContent(
  prompt: string,
  image: ClaudeImageInput | undefined
): string | Anthropic.Messages.ContentBlockParam[] {
  if (!image) return prompt
  // Image block first, then text — matches every pre-facade image call site
  // (step2-vision-analysis.ts, photo-quality-gate.ts).
  return [buildImageBlock(image), { type: 'text', text: prompt }]
}
```

Replace with:
```ts
function buildUserContent(
  prompt: string,
  image: ClaudeImageInput | undefined,
  images: ClaudeImageInput[] | undefined
): string | Anthropic.Messages.ContentBlockParam[] {
  const blocks = images && images.length > 0 ? images.map(buildImageBlock) : image ? [buildImageBlock(image)] : []
  if (blocks.length === 0) return prompt
  // Image blocks first, then text — matches every pre-facade image call site
  // (step2-vision-analysis.ts, photo-quality-gate.ts).
  return [...blocks, { type: 'text', text: prompt }]
}
```

Update the call site (`src/lib/claude/api-key-backend.ts:58`), currently:
```ts
    messages: [{ role: 'user', content: buildUserContent(params.prompt, params.image) }],
```
Replace with:
```ts
    messages: [{ role: 'user', content: buildUserContent(params.prompt, params.image, params.images) }],
```

- [ ] **Step 2: Extend the oauth backend's image-prompt builder**

Current (`src/lib/claude/oauth-backend.ts:47-70`):
```ts
async function* buildImagePromptStream(
  prompt: string,
  image: ClaudeImageInput
): AsyncGenerator<SDKUserMessage> {
  const { base64, mediaType } = await fetchImageAsBase64(image)

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType as Anthropic.Messages.Base64ImageSource['media_type'],
        data: base64,
      },
    },
    { type: 'text', text: prompt },
  ]

  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as SDKUserMessage
}
```

Replace with:
```ts
async function* buildImagesPromptStream(
  prompt: string,
  images: ClaudeImageInput[]
): AsyncGenerator<SDKUserMessage> {
  const fetched = await Promise.all(images.map(fetchImageAsBase64))

  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...fetched.map(({ base64, mediaType }) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: mediaType as Anthropic.Messages.Base64ImageSource['media_type'],
        data: base64,
      },
    })),
    { type: 'text', text: prompt },
  ]

  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as SDKUserMessage
}
```

Update the call site (`src/lib/claude/oauth-backend.ts:72-73`), currently:
```ts
export async function runStructuredOauth<T>(params: StructuredCallParams): Promise<T> {
  const prompt = params.image ? buildImagePromptStream(params.prompt, params.image) : params.prompt
```
Replace with:
```ts
export async function runStructuredOauth<T>(params: StructuredCallParams): Promise<T> {
  const images = params.images ?? (params.image ? [params.image] : [])
  const prompt = images.length > 0 ? buildImagesPromptStream(params.prompt, images) : params.prompt
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Lint**

Run: `npx eslint src/lib/claude/api-key-backend.ts src/lib/claude/oauth-backend.ts`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude/api-key-backend.ts src/lib/claude/oauth-backend.ts
git commit -m "feat(condition-qa): both Claude backends build N image blocks, not just 1

Every existing call site keeps using the singular image param unchanged
(image ?? images both funnel into the same block-building logic); only
the new condition-reassessment call site (a later task) will pass images."
```

---

### Task 4: `condition_confirmed` column and type

**Files:**
- Create: `supabase/migrations/0021_condition_confirmed.sql`
- Modify: `src/types/listings.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0021_condition_confirmed.sql`:
```sql
-- Default true (not false) is deliberate: existing listings never had a "pending approval"
-- concept for condition, so backfilling them all as false would retroactively block every
-- in-flight listing's Finalize step on a re-assessment they never asked for. true treats
-- existing data as already-implicitly-approved -- application code always writes false
-- explicitly whenever a NEW recalculation runs (condition-reassessment.ts), so the pending
-- state only ever appears going forward, on listings that actually go through the new flow.
-- Same principle as ai-listings-kks's inclusions backfill treating legacy included: true as
-- confirmed: true (0020_inclusions_shape_backfill.sql).
alter table listings
  add column condition_confirmed boolean not null default true;
```

- [ ] **Step 2: Apply the migration**

Run:
```bash
kubectl exec -i -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0021_condition_confirmed.sql
```
Expected: `ALTER TABLE` with no error. Note the `-i` flag is required — without it `kubectl exec` doesn't attach stdin and the command silently applies nothing (see `AGENTS.md`).

- [ ] **Step 3: Verify**

Run:
```bash
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres -c "select count(*) as total, count(*) filter (where condition_confirmed) as confirmed_true from listings;"
```
Expected: `total` equals `confirmed_true` (every existing row defaulted to `true`).

- [ ] **Step 4: Add the field to the `Listing` type**

Current (`src/types/listings.ts:257-258`):
```ts
  photos_confirmed: boolean;
  skip_background_removal: boolean;
```

Replace with:
```ts
  photos_confirmed: boolean;
  skip_background_removal: boolean;
  condition_confirmed: boolean;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_condition_confirmed.sql src/types/listings.ts
git commit -m "feat(condition-qa): add listings.condition_confirmed column

Defaults true for existing rows (no retroactive pending state); the
condition-reassessment Inngest function (a later task) always writes
false explicitly on a fresh recalculation."
```

---

### Task 5: Rewrite `photo-quality-gate.ts` for self-resolving escalation

**Files:**
- Modify: `src/lib/inngest/functions/photo-quality-gate.ts`

- [ ] **Step 1: Add the two new helpers**

Add immediately after the existing `checkPhotoQuality` function (`src/lib/inngest/functions/photo-quality-gate.ts:18-64`), before the `photoQualityGate` export:
```ts
async function supersedeReplacedPhoto(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  replacesPhotoId: string | undefined
): Promise<void> {
  if (!replacesPhotoId) return
  await supabase.from('photos').delete().eq('id', replacesPhotoId)
}

async function reconcileQualityEscalation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string
): Promise<void> {
  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId)
    .eq('type', 'studio')
    .eq('photoroom_meta->>quality_failed', 'true')

  if (!count) {
    await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', listingId)
  }
}
```

- [ ] **Step 2: Rewrite the function body**

Current full function (`src/lib/inngest/functions/photo-quality-gate.ts:66-149`, after sub-project 1's `ai-listings-kks` changes already merged — verify against the actual current file, the `detect-inclusions` step must be preserved unchanged):
```ts
export const photoQualityGate = inngest.createFunction(
  {
    id: 'photo-quality-gate',
    name: 'Photo Quality Gate',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl } = (
      event as unknown as StudioUploadedEvent
    ).data

    const quality = await step.run('check-quality', () => checkPhotoQuality(photoUrl))

    const supabase = getSupabaseAdmin()

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

    // ... existing detect-inclusions step, unchanged ...

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()

    if (listingRow?.skip_background_removal) {
      return { ok: true, listingId, photoId, skipped: true }
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .select('raw_url')
      .eq('id', photoId)
      .single()

    if (!photoRow?.raw_url) {
      throw new Error(`photo-quality-gate: photo ${photoId} has no raw_url`)
    }

    const apiKeys = await getUserApiKeys(listingRow?.user_id ?? null)
    const storagePath = `studio/${listingId}/processed-${photoId}.png`
    await removeBackground(photoId, photoRow.raw_url as string, storagePath, apiKeys)

    return { ok: true, listingId, photoId }
  }
)
```

Replace with (three changes: destructure `replacesPhotoId`, add escalation to the failure branch, add supersede+reconcile at both success exit points):
```ts
export const photoQualityGate = inngest.createFunction(
  {
    id: 'photo-quality-gate',
    name: 'Photo Quality Gate',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl, replacesPhotoId } = (
      event as unknown as StudioUploadedEvent
    ).data

    const quality = await step.run('check-quality', () => checkPhotoQuality(photoUrl))

    const supabase = getSupabaseAdmin()

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

      await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId))

      const { count } = await supabase
        .from('photos')
        .select('id', { count: 'exact', head: true })
        .eq('listing_id', listingId)
        .eq('type', 'studio')
        .eq('photoroom_meta->>quality_failed', 'true')

      await supabase
        .from('listings')
        .update({
          agent_blocked: true,
          agent_blocked_reason: `${count ?? 1} studio photo${(count ?? 1) === 1 ? '' : 's'} need${(count ?? 1) === 1 ? 's' : ''} attention — see the checklist below.`,
        })
        .eq('id', listingId)

      return { ok: false, listingId, photoId, issues: quality.issues }
    }

    // ... existing detect-inclusions step, unchanged ...

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()

    if (listingRow?.skip_background_removal) {
      await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId))
      await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId))
      return { ok: true, listingId, photoId, skipped: true }
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .select('raw_url')
      .eq('id', photoId)
      .single()

    if (!photoRow?.raw_url) {
      throw new Error(`photo-quality-gate: photo ${photoId} has no raw_url`)
    }

    const apiKeys = await getUserApiKeys(listingRow?.user_id ?? null)
    const storagePath = `studio/${listingId}/processed-${photoId}.png`
    await removeBackground(photoId, photoRow.raw_url as string, storagePath, apiKeys)

    await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId))
    await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId))

    return { ok: true, listingId, photoId }
  }
)
```

Preserve the existing `detect-inclusions` step (from `ai-listings-kks`) exactly where it currently sits, between the `!quality.passed` block and the `listingRow` select — do not move or modify it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Manual verification**

Upload a deliberately bad studio photo (near-black or heavily blurred) for a real listing in dev. Confirm: the `photos` row gets `photoroom_meta.quality_failed = true`; the `listings` row gets `agent_blocked = true` with a reason mentioning the photo count; querying `photos` for that listing shows no row was deleted (no `replacesPhotoId` was sent on this first upload, so nothing to supersede). Then upload a second, good studio photo for the same listing with no `replacesPhotoId` (simulating an unrelated normal upload) and confirm `agent_blocked` stays `true` (the first bad photo is still outstanding) — this validates `reconcileQualityEscalation` doesn't clear on an unrelated passing photo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inngest/functions/photo-quality-gate.ts
git commit -m "feat(condition-qa): photo-quality-gate.ts escalates via agent_blocked, self-resolves

A quality failure now blocks the listing (agent_blocked=true) instead of
silently dead-ending in photoroom_meta with no UI surfacing anywhere.
Whichever of the three exit points a run takes (fail, skip-bg-removal,
full processing), it supersedes any replaced photo and recomputes
agent_blocked fresh by re-querying for outstanding quality_failed
photos -- never toggled by assuming which branch ran, never requiring
a manual 'mark resolved' step."
```

---

### Task 6: Studio-upload route forwards `replacesPhotoId`, add the "Use as-is" route

**Files:**
- Modify: `src/app/api/studio-upload/route.ts`
- Create: `src/app/api/photos/[id]/quality-override/route.ts`

- [ ] **Step 1: Accept and forward `replacesPhotoId`**

Current (`src/app/api/studio-upload/route.ts:14-17`):
```ts
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('photo') as File | null
  const listingId = formData.get('listingId') as string | null
```

Replace with:
```ts
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('photo') as File | null
  const listingId = formData.get('listingId') as string | null
  const replacesPhotoId = formData.get('replacesPhotoId') as string | null
```

Current event send (`src/app/api/studio-upload/route.ts:53-60`):
```ts
  await inngest.send({
    name: 'studio/uploaded',
    data: {
      listingId,
      photoId: photoRow.id as string,
      photoUrl,
    },
  })
```

Replace with:
```ts
  await inngest.send({
    name: 'studio/uploaded',
    data: {
      listingId,
      photoId: photoRow.id as string,
      photoUrl,
      ...(replacesPhotoId ? { replacesPhotoId } : {}),
    },
  })
```

- [ ] **Step 2: Create the quality-override route**

Create `src/app/api/photos/[id]/quality-override/route.ts`:
```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { getUserApiKeys } from '@/lib/user-api-keys'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: photoRow } = await supabase
    .from('photos')
    .select('id, listing_id, raw_url, photoroom_meta, listings!inner(user_id, skip_background_removal)')
    .eq('id', id)
    .eq('listings.user_id', user.id)
    .single()

  if (!photoRow) return Response.json({ error: 'Not found' }, { status: 404 })

  await supabase
    .from('photos')
    .update({
      photoroom_meta: { ...(photoRow.photoroom_meta as Record<string, unknown>), quality_failed: false, quality_overridden: true },
    })
    .eq('id', id)

  const listingRow = photoRow.listings as unknown as { user_id: string; skip_background_removal: boolean }
  if (!listingRow.skip_background_removal) {
    const apiKeys = await getUserApiKeys(listingRow.user_id)
    const storagePath = `studio/${photoRow.listing_id}/processed-${id}-override.png`
    await removeBackground(id, photoRow.raw_url as string, storagePath, apiKeys)
  }

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', photoRow.listing_id)
    .eq('type', 'studio')
    .eq('photoroom_meta->>quality_failed', 'true')

  if (!count) {
    await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', photoRow.listing_id)
  }

  return Response.json({ ok: true })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Lint**

Run: `npx eslint src/app/api/studio-upload/route.ts src/app/api/photos/[id]/quality-override/route.ts`
Expected: clean

- [ ] **Step 5: Manual verification**

Against a listing with a `quality_failed` studio photo (from Task 5's verification), call `PATCH /api/photos/<that photo id>/quality-override` (e.g. via `curl` with a valid session cookie, or a temporary button while testing). Confirm: `photoroom_meta.quality_failed` becomes `false` with `quality_overridden: true`; `processed_url` gets set (background removal ran); if this was the only outstanding flagged photo, `agent_blocked` clears on the listing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/studio-upload/route.ts "src/app/api/photos/[id]/quality-override/route.ts"
git commit -m "feat(condition-qa): studio-upload forwards replacesPhotoId; add quality-override route

studio-upload/route.ts passes an optional replacesPhotoId through to the
studio/uploaded event (consumed by photo-quality-gate.ts's supersede
logic from the prior task). The new quality-override route backs the
'Use as-is' action -- clears a photo's failed flag, runs the
removeBackground call it skipped on failure, and re-checks whether
agent_blocked should clear."
```

---

### Task 7: Confirm-photos fires recalculation + fixes its ownership gap; add condition-reassessment and condition-approval routes

**Files:**
- Modify: `src/app/api/listings/[id]/confirm-photos/route.ts`
- Create: `src/lib/inngest/functions/condition-reassessment.ts`
- Modify: `src/app/api/inngest/route.ts`
- Create: `src/app/api/listings/[id]/condition/route.ts`

- [ ] **Step 1: Fix ownership and fire the event**

Current full file (`src/app/api/listings/[id]/confirm-photos/route.ts`):
```ts
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
  const { error } = await supabase
    .from('listings')
    .update({ photos_confirmed: true })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

Replace with:
```ts
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('listings')
    .update({ photos_confirmed: true })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await inngest.send({ name: 'listing/photos-confirmed', data: { listingId: id } })

  return Response.json({ ok: true })
}
```

This also fixes the pre-existing ownership gap tracked in `ai-listings-7ab` (the prior `update` had no `user_id` filter).

- [ ] **Step 2: Create the condition-reassessment Inngest function**

Create `src/lib/inngest/functions/condition-reassessment.ts`:
```ts
import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { ListingPhotosConfirmedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { ClaudeImageInput } from '@/lib/claude'
import type { ConditionValue } from '@/types/listings'

interface ConditionOutput {
  condition: ConditionValue
  condition_notes: string
}

async function reassessCondition(
  photoUrls: string[],
  apiKey: string | undefined
): Promise<ConditionOutput> {
  const images: ClaudeImageInput[] = await Promise.all(
    photoUrls.map(async (url) => ({ url: await toPublicUrl(url) }))
  )

  try {
    return await runStructured<ConditionOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 512,
      images,
      apiKey,
      toolName: 'reassess_condition',
      toolDescription: 'Re-assess item condition from the full set of studio photos',
      prompt: `These are all the studio photos for this resale listing, taken after background removal/review. Reassess the item's condition using everything visible across all of them -- wear, completeness, defects that may not have been visible in the original single intake photo.

Use the generate_listing condition scale: new_with_tags, new_without_tags, like_new, very_good, good, fair, poor, for_parts.`,
      jsonSchema: {
        type: 'object' as const,
        properties: {
          condition: {
            type: 'string',
            enum: ['new_with_tags', 'new_without_tags', 'like_new', 'very_good', 'good', 'fair', 'poor', 'for_parts'],
          },
          condition_notes: { type: 'string' },
        },
        required: ['condition', 'condition_notes'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('condition-reassessment: Claude did not return a tool_use block')
    }
    throw err
  }
}

export const conditionReassessment = inngest.createFunction(
  { id: 'condition-reassessment', name: 'Condition Re-assessment', triggers: [{ event: 'listing/photos-confirmed' }], retries: 1 },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as ListingPhotosConfirmedEvent).data
    const supabase = getSupabaseAdmin()

    const result = await step.run('reassess-condition', async () => {
      const { data: listingRow } = await supabase
        .from('listings')
        .select('user_id, skip_background_removal')
        .eq('id', listingId)
        .single()
      if (!listingRow) return null

      const { data: photos } = await supabase
        .from('photos')
        .select('processed_url, raw_url')
        .eq('listing_id', listingId)
        .eq('type', 'studio')

      const urls = (photos ?? [])
        .map((p) => (listingRow.skip_background_removal ? p.raw_url : p.processed_url ?? p.raw_url) as string)
        .filter(Boolean)
      if (urls.length === 0) return null

      const apiKeys = await getUserApiKeys(listingRow.user_id)
      const output = await reassessCondition(urls, apiKeys.anthropic)
      return { condition: output.condition, condition_notes: output.condition_notes }
    })

    if (!result) return { ok: false, listingId, reason: 'no studio photos or listing not found' }

    await supabase
      .from('listings')
      .update({ condition: result.condition, condition_notes: result.condition_notes, condition_confirmed: false })
      .eq('id', listingId)

    return { ok: true, listingId }
  }
)
```

- [ ] **Step 3: Register the new function**

In `src/app/api/inngest/route.ts`, add the import and registry entry:
```ts
import { conditionReassessment } from '@/lib/inngest/functions/condition-reassessment'
```
and add `conditionReassessment,` to the `functions: [...]` array (alongside `photoQualityGate` and the others from Task 1's edit).

- [ ] **Step 4: Create the condition-approval route**

Create `src/app/api/listings/[id]/condition/route.ts`:
```ts
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
  const { error } = await supabase
    .from('listings')
    .update({ condition_confirmed: true })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```
This mirrors `confirm-photos/route.ts`'s shape exactly (same ownership-filtered single-field PATCH), including the ownership filter from the start — no gap to fix later.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Lint**

Run: `npx eslint "src/app/api/listings/[id]/confirm-photos/route.ts" src/lib/inngest/functions/condition-reassessment.ts src/app/api/inngest/route.ts "src/app/api/listings/[id]/condition/route.ts"`
Expected: clean

- [ ] **Step 7: Manual verification**

On a listing with 2+ studio photos that have already passed quality (no outstanding `agent_blocked`), call `PATCH /api/listings/<id>/confirm-photos`. Confirm: `photos_confirmed` becomes `true`; within a few seconds, the listing's `condition` and `condition_notes` update and `condition_confirmed` becomes `false`. Then call `PATCH /api/listings/<id>/condition` and confirm `condition_confirmed` becomes `true`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/api/listings/[id]/confirm-photos/route.ts" src/lib/inngest/functions/condition-reassessment.ts src/app/api/inngest/route.ts "src/app/api/listings/[id]/condition/route.ts"
git commit -m "feat(condition-qa): condition re-assessment triggered off photos_confirmed

confirm-photos/route.ts now fires listing/photos-confirmed (and gets its
pre-existing ownership gap fixed, ai-listings-7ab) after setting the flag.
The new condition-reassessment Inngest function re-runs vision analysis
over every studio photo in one Claude call (images?: plural, added in
Task 3) and writes a pending condition + condition_notes for approval.
The new condition/route.ts backs that approval action."
```

---

### Task 8: Finalize gate on `condition_confirmed`

**Files:**
- Modify: `src/app/api/listings/[id]/finalize/route.ts`

- [ ] **Step 1: Add the interim gate**

Current full file (`src/app/api/listings/[id]/finalize/route.ts`):
```ts
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

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}
```

Replace with:
```ts
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

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, condition_confirmed')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // INTERIM: blocks Finalize on condition_confirmed until ai-listings-yva's real
  // pricing-gate design lands. ai-listings-yva's acceptance criteria include
  // reconciling (keep/replace/remove) this exact check -- see that ticket
  // before removing or duplicating this gate.
  if (!listing.condition_confirmed) {
    return Response.json({ error: 'Condition must be approved before finalizing.' }, { status: 400 })
  }

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Manual verification**

On a listing with `condition_confirmed = false`, call `PATCH /api/listings/<id>/finalize` and confirm a 400 with the expected error message. Approve condition (Task 7's condition route), retry, and confirm success (status becomes `finalizing`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/listings/[id]/finalize/route.ts"
git commit -m "feat(condition-qa): gate Finalize on condition_confirmed (interim)

Marked INTERIM, citing ai-listings-yva -- that ticket's own acceptance
criteria (updated in the final task of this plan) require reconciling
this exact check once the real pricing gate is designed, so it can't be
silently forgotten."
```

---

### Task 9: FieldsPanel UI — QA-escalation checklist banner and Condition approval

**Files:**
- Modify: `src/components/workspace/FieldsPanel.tsx`

- [ ] **Step 1: Add imports and the `QaChecklistRow` subcomponent**

Add one new import to the existing imports (`src/components/workspace/FieldsPanel.tsx:1-13`) — `useRef` is already imported at `:3` and is reused for the new refs added in Step 2, no duplicate import needed:
```ts
import Image from 'next/image'
```

Add the `QaChecklistRow` component in this file, following the existing convention of colocating small subcomponents (matches `AuthStepIcon`, `:39-43`). Place it directly above the `FieldsPanel` export:
```tsx
interface QaChecklistRowProps {
  photo: Photo
  onRetake: (photoId: string) => void
  onUseAsIs: (photoId: string) => Promise<void>
}

function QaChecklistRow({ photo, onRetake, onUseAsIs }: Readonly<QaChecklistRowProps>) {
  const meta = photo.photoroom_meta as { quality_verdict?: string } | null
  return (
    <div className="rounded bg-black/20 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-none w-10 h-10 rounded border border-red-700 overflow-hidden bg-gray-800">
          {photo.raw_url && <Image src={photo.raw_url} alt="" fill className="object-cover" />}
        </div>
        <p className="flex-1 min-w-0 text-[11px] text-orange-300">{meta?.quality_verdict ?? 'Quality issue'}</p>
      </div>
      <div className="flex gap-1.5 pl-12">
        <button
          onClick={() => onRetake(photo.id)}
          className="text-[10px] px-2 py-1 rounded bg-orange-900/50 text-orange-300 hover:bg-orange-900/70 transition-colors"
        >
          Retake
        </button>
        <button
          onClick={() => void onUseAsIs(photo.id)}
          className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
        >
          Use as-is
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add retake state and handlers inside `FieldsPanel`**

Add alongside the existing state declarations (`src/components/workspace/FieldsPanel.tsx:46-51`, right after `addInputRef`):
```tsx
  const retakeTargetPhotoId = useRef<string | null>(null)
  const retakeFileInputRef = useRef<HTMLInputElement>(null)

  function startRetake(photoId: string) {
    retakeTargetPhotoId.current = photoId
    retakeFileInputRef.current?.click()
  }

  async function handleRetakeFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const replacesPhotoId = retakeTargetPhotoId.current
    e.target.value = ''
    if (!file || !replacesPhotoId) return

    const formData = new FormData()
    formData.append('photo', file)
    formData.append('listingId', listing.id)
    formData.append('replacesPhotoId', replacesPhotoId)
    await fetch('/api/studio-upload', { method: 'POST', body: formData })
  }

  async function handleUseAsIs(photoId: string) {
    await fetch(`/api/photos/${photoId}/quality-override`, { method: 'PATCH' })
  }
```

- [ ] **Step 3: Render the escalation banner and hidden retake file input**

Current bare banner (`src/components/workspace/FieldsPanel.tsx:514-519`):
```tsx
        {listing.agent_blocked && listing.agent_blocked_reason && (
          <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5">
            <p className="text-xs font-medium text-orange-400 mb-0.5">Agent waiting</p>
            <p className="text-xs text-orange-300/80">{listing.agent_blocked_reason}</p>
          </div>
        )}
```

Replace with:
```tsx
        {(() => {
          const flaggedPhotos = photos.filter(
            (p) => p.type === 'studio' && (p.photoroom_meta as { quality_failed?: boolean } | null)?.quality_failed
          )
          if (listing.agent_blocked && flaggedPhotos.length > 0) {
            return (
              <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5 space-y-3">
                <p className="text-xs font-medium text-orange-400">
                  Agent waiting — {flaggedPhotos.length} photo{flaggedPhotos.length === 1 ? '' : 's'} need{flaggedPhotos.length === 1 ? 's' : ''} attention
                </p>
                {flaggedPhotos.map((photo) => (
                  <QaChecklistRow key={photo.id} photo={photo} onRetake={startRetake} onUseAsIs={handleUseAsIs} />
                ))}
                <input
                  ref={retakeFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleRetakeFileSelected(e)}
                />
              </div>
            )
          }
          if (listing.agent_blocked && listing.agent_blocked_reason) {
            return (
              <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5">
                <p className="text-xs font-medium text-orange-400 mb-0.5">Agent waiting</p>
                <p className="text-xs text-orange-300/80">{listing.agent_blocked_reason}</p>
              </div>
            )
          }
          return null
        })()}
```

- [ ] **Step 4: Add the Condition approval handler**

Add alongside the existing `saveInclusions`/`confirmInclusion` handlers (`src/components/workspace/FieldsPanel.tsx:127-142`):
```tsx
  async function approveCondition() {
    await fetch(`/api/listings/${listing.id}/condition`, { method: 'PATCH' })
  }
```

- [ ] **Step 5: Replace the Condition `dl` row with the pending/confirmed split**

Current (`src/components/workspace/FieldsPanel.tsx:228-233`):
```tsx
          {listing.condition && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Condition</dt>
              <dd className="text-gray-300">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd>
            </div>
          )}
```

Replace with:
```tsx
          {listing.condition && listing.condition_confirmed && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Condition</dt>
              <dd className="text-gray-300">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd>
            </div>
          )}
```

Immediately after the closing `</dl>` of the same block (the `dl` containing Category/Condition/Notes, ending at `src/components/workspace/FieldsPanel.tsx:224`), insert the pending-condition section:
```tsx
        {listing.condition && !listing.condition_confirmed && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Condition
            </h3>
            <div className="flex items-start gap-2 px-2 py-2 rounded bg-amber-950/40 border-l-2 border-amber-600">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-300 font-medium">
                  {CONDITION_LABELS[listing.condition] ?? listing.condition}
                  <span className="text-amber-600/70 font-normal"> — recalculated from studio photos</span>
                </p>
                {listing.condition_notes && (
                  <p className="text-[10px] text-amber-600/80 mt-0.5 leading-snug">{listing.condition_notes}</p>
                )}
              </div>
              <div className="flex-none flex gap-1.5 pt-0.5">
                <button onClick={() => void approveCondition()} className="text-emerald-500 hover:text-emerald-400" title="Approve">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </section>
        )}
```
`Check` is already imported from `lucide-react` (`:4`) — no new icon import needed.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Lint**

Run: `npx eslint src/components/workspace/FieldsPanel.tsx`
Expected: clean

- [ ] **Step 8: Manual verification**

Run `npm run dev`, open a real listing that has a `quality_failed` studio photo (from Task 5's manual test): confirm the checklist banner renders with a thumbnail and the issue text, `Retake` opens a file picker, and after selecting a good replacement image the row eventually disappears (via `AutoRefresh`'s poll) and the dashboard blocked badge clears. Separately, on a listing with `condition_confirmed = false`, confirm the amber pending Condition section renders with the recalculated value and notes, clicking the check icon approves it, and it collapses to the plain `dl` row on the next render.

- [ ] **Step 9: Commit**

```bash
git add src/components/workspace/FieldsPanel.tsx
git commit -m "feat(condition-qa): FieldsPanel QA-escalation checklist and Condition approval UI

Escalation banner now renders one row per flagged studio photo (thumbnail
+ specific issue + Retake/Use-as-is), falling back to the old plain
banner only if agent_blocked is ever true with no flagged photos.
Condition section mirrors the pending/confirmed visual language
ai-listings-kks established for Inclusions."
```

---

### Task 10: Full-suite verification and handoff to sub-project 3

**Files:** None (verification only, plus a `bd` update)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean (aside from the one known pre-existing unrelated error in `oauth-backend.ts`'s file header context, if any — confirm nothing new)

- [ ] **Step 2: Full lint**

Run: `npx eslint src/`
Expected: no new errors introduced by this branch's changes (any pre-existing warnings unrelated to files this plan touched are out of scope)

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: same pass count as `main` before this branch — this plan adds no new test files

- [ ] **Step 4: Full manual smoke pass**

Walk through, on a real listing in dev, in order:
1. Upload a studio photo that fails quality → confirm checklist banner + dashboard blocked badge.
2. Retake it with a good photo → confirm the row disappears and the block clears automatically, no manual step.
3. Upload a second bad photo, this time use "Use as-is" → confirm it clears and the photo gets a `processed_url`.
4. Confirm processed photos (`Looks good ✓` in chat, or the equivalent PATCH) → confirm condition recalculates and renders pending (amber) in `FieldsPanel`.
5. Approve condition → confirm it collapses to plain text.
6. Attempt Finalize before approving condition on a *different* listing (or before step 5 on this one) → confirm the 400; after approval, confirm Finalize succeeds.

- [ ] **Step 5: Update `ai-listings-yva`'s acceptance criteria**

Run:
```bash
bd show ai-listings-yva
```
Then append (via `bd update ai-listings-yva --description "<existing description>\n\nAcceptance criterion added by ai-listings-e75: reconcile the interim Finalize-gate (condition_confirmed check in src/app/api/listings/[id]/finalize/route.ts, marked with an INTERIM comment citing this ticket) -- decide whether the real pricing gate subsumes it, replaces it, or it stays as a permanent invariant alongside pricing confirmation."`) preserving the ticket's full existing description text (read it first via the `bd show` output, do not truncate it).

- [ ] **Step 6: Push the branch and open the PR**

```bash
git push -u origin feat/condition-reassessment-qa-escalation
```
Open the PR containing the spec, this plan, and all 9 implementation commits in one PR (per the established convention — spec/plan/code land together, not one PR per stage). Drive it through review per the `driving-a-pr-to-approval` runbook. Do not close `ai-listings-e75` until the PR merges.

---

## Self-Review

**Spec coverage:** Every one of the spec's 15 numbered Task Designs maps to a plan task above — 1↔Task 1, 2-3↔Task 2, 7↔Task 2, 8-9↔Task 3, 11-12↔Task 4, 4↔Task 5, 3↔Task 6, 5-6, 10↔Task 6-7, 13↔Task 9, 14↔Task 8, 15↔Task 10 Step 5. The spec's "Explicitly Out of Scope" section (condition edit UI, retroactive recalculation, general photo deletion, brand-specific criteria) has no corresponding task, correctly.

**Placeholder scan:** No "TBD"/"TODO"/"handle appropriately" language in any step above; every code block is complete, copy-pasteable, and shows the actual before/after diff rather than describing it. Task 5's Step 2 code block includes a `// ... existing detect-inclusions step, unchanged ...` comment marking a deliberately-elided region — this is not a placeholder for missing plan content, it's an instruction to preserve existing code from a prior merged PR (`ai-listings-kks`) verbatim rather than risk an implementer copy-pasting a stale duplicate of it; the surrounding before/after blocks are otherwise complete.

**Type consistency:** `replacesPhotoId` (Task 2's event type → Task 5's destructure → Task 6's form field → Task 9's `retakeTargetPhotoId`/`startRetake`) is spelled identically throughout. `condition_confirmed` (Task 4's column/type → Task 7's write in `condition-reassessment.ts` and the new `condition/route.ts` → Task 8's gate → Task 9's UI check) is spelled identically throughout. `images?: ClaudeImageInput[]` (Task 2's type → Task 3's both backends → Task 7's `condition-reassessment.ts` call) matches exactly. `QaChecklistRow`'s `onRetake`/`onUseAsIs` prop names match the handlers passed to it (`startRetake`, `handleUseAsIs`) in Task 9.
