# Condition Re-assessment + Photo Quality-Gate QA Escalation — Design Spec

**Date:** 2026-08-18
**Status:** Approved
**Derived from:** brainstorming session 2026-08-18, bd issue `ai-listings-e75`

---

## What This Builds

Sub-project 2 of the 3-part pipeline-accuracy redesign (sub-project 1, inclusions taxonomy, merged as PR #47 / `ai-listings-kks`; sub-project 3, pricing retiming, `ai-listings-yva`, not yet spec'd — depends on this one).

Condition is estimated once, from the single intake photo, in `step2-vision-analysis.ts` — never re-assessed once studio photos exist, and there's no approval UI (`FieldsPanel.tsx` renders it as read-only text). Real condition (wear, completeness, defects) only becomes clear once studio photos show the actual item close-up. A photo quality gate already exists (`photo-quality-gate.ts`, Claude vision checking blur/exposure/framing on every studio upload) but is a dead end today: on failure it writes `photos.photoroom_meta` and returns — nothing reads that anywhere in the UI, and the failed photo never gets a `processed_url`, so `studioPhotosReady()` returns `false` forever with no recovery path.

This spec:
1. Deletes `studio-photo-process.ts` — a second Inngest handler on the same `studio/uploaded` event that unconditionally calls `removeBackground` and resets `photoroom_meta: {}` on write, silently defeating the quality gate it races. `photo-quality-gate.ts` already calls `removeBackground` itself on its quality-pass branch; the duplicate is superseded, not coordinated with.
2. Turns a quality failure into a real, visible, self-resolving escalation: `agent_blocked` (already wired through the dashboard, the workspace banner, chat, and the agent's own system prompt) gets set; `FieldsPanel` renders a checklist of the specific flagged photos (thumbnail + issue) instead of the current bare "Agent waiting" text; each flagged photo gets an explicit **Retake** action (uploads a replacement tagged to that specific photo, shows old→new thumbnails side by side while the new one is checked) or **Use as-is** (explicit override). Resolution is verified by the system, not declared by a click — the block clears itself once every flagged photo is retaken-and-passed or explicitly overridden.
3. Adds condition re-assessment: once you confirm processed studio photos look right (the existing `photos_confirmed` checkpoint), a new Inngest function re-runs vision analysis over the **full set** of studio photos in one Claude call and writes a new `condition` + `condition_notes`, flagged `condition_confirmed: false` for your approval — rendered in `FieldsPanel` with the same pending/confirmed visual language sub-project 1 already established for Inclusions.
4. Gates the `in_loop → finalizing` transition on `condition_confirmed`, as an explicit interim measure pending sub-project 3's real pricing-gate design.

**Done when:** `studio-photo-process.ts` is gone; a quality-failed studio photo blocks the listing with a checklist banner naming the specific photo and issue (not just "Agent waiting"); retaking a flagged photo replaces it and auto-clears once it passes, with no manual "mark resolved" step; "Use as-is" overrides a single flagged photo without needing a retake; confirming processed photos triggers a condition recalculation over all studio photos; the recalculated condition renders pending in `FieldsPanel` with approve/edit actions; and `FinalizeButton` is blocked until condition is approved, with removal of that block tracked as an explicit acceptance criterion on `ai-listings-yva`.

---

## Architecture

- **Dead code removal is step one, not a side quest.** `studio-photo-process.ts` and `photo-quality-gate.ts` both trigger on `studio/uploaded` and both call `removeBackground`; the former does so unconditionally and resets `photoroom_meta: {}` on write (`remove-background.ts:34`), which silently erases whatever quality verdict the gate wrote whenever it wins the race. `photo-quality-gate.ts`'s own quality-pass branch already calls `removeBackground` (`:144`), so the second function is fully redundant. Confirmed via production query: 0 studio photos exist yet, so this is a guaranteed-imminent bug, not a live incident — cheap to fix now, actively dangerous to build sub-project 2 on top of otherwise.
- **No new persisted linkage for retakes.** The natural instinct is a `replaces_photo_id` column on `photos`, but the only place that reference is ever needed is the single Inngest execution that runs the quality check on the replacement — so it travels as an optional field on the existing `studio/uploaded` event payload instead. No migration, no FK, no cleanup of a dangling reference after the old photo is deleted.
- **`agent_blocked` is reused as-is, not extended with a new "reason type."** Confirmed via grep: today, nothing sets `agent_blocked` once a listing reaches `in_loop` — only `intake-pipeline.ts` and `text-intake-pipeline.ts` do, both pre-`in_loop`. This spec becomes the sole owner of `agent_blocked` from `in_loop` onward, which is what makes "recompute and auto-clear whenever the outstanding-issues query goes empty" safe without needing to tag *why* it was set. `FieldsPanel` still renders today's plain banner as a fallback if `agent_blocked` is ever true with zero `quality_failed` photos (defensive, not expected to fire under this invariant).
- **The escalation checklist is a live query, not parsed text.** `agent_blocked_reason` stays a short human-readable summary ("2 studio photos need attention"); the actual per-photo checklist FieldsPanel renders is built by querying `photos` directly (`type = 'studio' AND photoroom_meta->>'quality_failed' = 'true'`) every time the page loads. One source of truth, no risk of the reason string and the real state drifting apart.
- **Condition recalculation is event-triggered off the existing `photos_confirmed` checkpoint**, not off "all studio photos have `processed_url`." You already review processed photos before anything else in `in_loop` proceeds (the "Looks good ✓" step); recalculating condition off photos you haven't looked at yet risks computing it from a background-removal crop you're about to reject. `confirm-photos/route.ts` fires a new event after setting `photos_confirmed: true`; a new dedicated Inngest function does the recalculation, matching the existing convention of one function per pipeline concern rather than growing `photo-quality-gate.ts` further.
- **One Claude call, not N.** "Full set of studio photos" means every studio photo's final image (`processed_url`, or `raw_url` if `skip_background_removal`) attached to a single structured-output call, so Claude reasons about the whole item at once — closer to how a human would actually assess condition than N independent single-photo judgments merged after the fact. Requires a small additive extension to the Claude call facade (`ClaudeImageInput` → plural `images?:` alongside the existing singular `image?:`); both backends already build one image content-block per call, so this is a loop, not new plumbing.
- **The Finalize gate is written to be found later, not just remembered.** The interim block cites `ai-listings-yva` by name in a code comment at the exact gate site, and `ai-listings-yva`'s own bd description gets an explicit acceptance-criterion line added as part of this spec (Task below) — so sub-project 3's own brainstorm has to see and decide on it, not silently inherit stale wiring.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|-----------------|
| `src/lib/inngest/functions/studio-photo-process.ts` | **Delete** | Superseded duplicate handler |
| `src/app/api/inngest/route.ts` | Modify | Drop the deleted function's registration |
| `src/lib/inngest/client.ts` | Modify | `StudioUploadedEvent.data` gains `replacesPhotoId?: string`; new `ListingPhotosConfirmedEvent` |
| `src/lib/inngest/functions/photo-quality-gate.ts` | Modify | Set `agent_blocked` on failure; handle `replacesPhotoId` cleanup + auto-clear after every run |
| `src/app/api/studio-upload/route.ts` | Modify | Accept + forward `replacesPhotoId` |
| `src/app/api/photos/[id]/quality-override/route.ts` | Create | Backs "Use as-is": clears the failed flag, runs the deferred `removeBackground`, re-checks auto-clear |
| `src/app/api/listings/[id]/confirm-photos/route.ts` | Modify | Fire `listing/photos-confirmed` after setting `photos_confirmed`; fix the tracked ownership gap (`ai-listings-7ab`) while the file is open |
| `src/lib/inngest/functions/condition-reassessment.ts` | Create | Re-run vision analysis over all studio photos, write pending `condition`/`condition_notes`/`condition_confirmed` |
| `src/lib/claude/types.ts` | Modify | `StructuredCallParams` gains `images?: ClaudeImageInput[]` |
| `src/lib/claude/api-key-backend.ts` | Modify | `buildUserContent` emits one image block per entry in `images` (in addition to the existing singular `image`) |
| `src/lib/claude/oauth-backend.ts` | Modify | Same extension for the OAuth backend's content-block builder |
| `src/types/listings.ts` | Modify | `Listing` gains `condition_confirmed: boolean` |
| `supabase/migrations/0021_condition_confirmed.sql` | Create | `alter table listings add column condition_confirmed boolean not null default true` (see rationale below — default `true` for existing rows, code path always writes `false` on a fresh recalculation) |
| `src/components/workspace/FieldsPanel.tsx` | Modify | QA-escalation checklist banner (thumbnail + issue + Retake/Use-as-is per row); Condition section pending/confirmed treatment |
| `src/components/workspace/FinalizeButton.tsx` or `src/app/api/listings/[id]/finalize/route.ts` | Modify | Block finalize until `condition_confirmed`, with the `ai-listings-yva` marker comment |
| bd `ai-listings-yva` | Update (bd, not a file) | Add the interim-gate reconciliation as an explicit acceptance criterion |

---

## Task Designs

### 1. Delete the duplicate Inngest handler

Delete `src/lib/inngest/functions/studio-photo-process.ts` entirely. Remove its import and registry entry in `src/app/api/inngest/route.ts:6,19`. No migration needed — this is pure code removal; `photo-quality-gate.ts` already performs the same `removeBackground` call on its quality-pass branch (`:144`), conditioned correctly on `skip_background_removal` and quality passing, which the duplicate was not.

### 2. Event payload extensions (`src/lib/inngest/client.ts`)

Extend the existing interface (`:44-50`):
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
```

Add a new event, following the exact shape of `PipelineGenderConfirmedEvent` (`:32-39`):
```ts
export interface ListingPhotosConfirmedEvent {
  name: 'listing/photos-confirmed'
  data: {
    listingId: string
  }
}
```

### 3. `src/app/api/studio-upload/route.ts` — accept and forward `replacesPhotoId`

Current handler reads `photo` and `listingId` from `FormData` (`:15-16`) and sends the `studio/uploaded` event (`:53-60`). Add:
```ts
const replacesPhotoId = formData.get('replacesPhotoId') as string | null
```
and include it in the event payload only when present:
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

### 4. `photo-quality-gate.ts` — escalation + auto-resolution

Current structure: `check-quality` step → on failure, write `photoroom_meta` and return (`:82-95`); on pass, `detect-inclusions` step (unchanged by this spec) → background-removal branch (`:122-146`).

Add two helpers, colocated in this file (no new module needed — both have exactly one call site, in this function):
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

`supersedeReplacedPhoto` runs unconditionally once the new photo's quality outcome is known — pass or fail, the old one is superseded, never on the click. `reconcileQualityEscalation` clears `agent_blocked` only when zero `quality_failed` studio photos remain for the listing — safe per the "sole owner from `in_loop` onward" invariant established in Architecture. Both take `supabase` as a parameter rather than closing over it, matching this file's existing style of small testable-shaped helpers even though there's no test harness for this file today.

Full replacement of the function body (`:73-147`), with the new pieces marked:
```ts
export const photoQualityGate = inngest.createFunction(
  { id: 'photo-quality-gate', name: 'Photo Quality Gate', triggers: [{ event: 'studio/uploaded' }], retries: 1 },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl, replacesPhotoId } = (
      event as unknown as StudioUploadedEvent
    ).data // <-- replacesPhotoId is new

    const quality = await step.run('check-quality', () => checkPhotoQuality(photoUrl))
    const supabase = getSupabaseAdmin()

    if (!quality.passed) {
      await supabase
        .from('photos')
        .update({
          photoroom_meta: { quality_failed: true, quality_issues: quality.issues, quality_verdict: quality.verdict },
        })
        .eq('id', photoId)

      // <-- new: resolve the old photo now that this attempt's outcome is known
      await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId))

      // <-- new: block the listing, describing every currently-outstanding issue, not just this one
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

    // unchanged: detect-inclusions step (sub-project 1, ai-listings-kks) goes here

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()

    if (listingRow?.skip_background_removal) {
      await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId)) // <-- new
      await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId)) // <-- new
      return { ok: true, listingId, photoId, skipped: true }
    }

    // unchanged: raw_url fetch + removeBackground call

    await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, replacesPhotoId)) // <-- new
    await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId)) // <-- new
    return { ok: true, listingId, photoId }
  }
)
```
Net effect: whichever of the three exit points this run takes (fail, skip-bg-removal, or full processing), the old photo is superseded and `agent_blocked` is recomputed fresh — never toggled by assuming which branch ran.

### 5. `src/app/api/photos/[id]/quality-override/route.ts` — "Use as-is" (new)

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
Ownership enforced via the `listings!inner(...)` join filter, matching the join-based ownership pattern already used elsewhere in this codebase's Supabase queries (not the `.eq('user_id', ...)` chained-onto-update pattern used for JSONB columns like inclusions — this route reads before writing, so the join filter is the natural fit, same as a plain authenticated `select`).

### 6. `src/app/api/listings/[id]/confirm-photos/route.ts` — fire recalculation, fix ownership

Current (`:1-19`) has no ownership filter on the `update` (same class of gap as the inclusions route was, tracked under `ai-listings-7ab`) and does nothing beyond setting the flag. Fixed and extended:
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

### 7. `src/lib/claude/types.ts` — plural `images`

Extend `StructuredCallParams` (`:14-31`):
```ts
export interface StructuredCallParams {
  model: string
  prompt: string
  jsonSchema: Record<string, unknown>
  image?: ClaudeImageInput
  images?: ClaudeImageInput[]
  apiKey?: string
  maxTokens?: number
  toolName?: string
  toolDescription?: string
}
```
Both fields coexist — every existing call site keeps using singular `image` unchanged; only the new condition-reassessment call site uses `images`.

### 8. `src/lib/claude/api-key-backend.ts` — build N image blocks

Current `buildUserContent` (`:23-31`) handles only the singular case. Extend:
```ts
function buildUserContent(
  prompt: string,
  image: ClaudeImageInput | undefined,
  images: ClaudeImageInput[] | undefined
): string | Anthropic.Messages.ContentBlockParam[] {
  const blocks = images && images.length > 0 ? images.map(buildImageBlock) : image ? [buildImageBlock(image)] : []
  if (blocks.length === 0) return prompt
  return [...blocks, { type: 'text', text: prompt }]
}
```
Call site (`:58`) becomes `buildUserContent(params.prompt, params.image, params.images)`.

### 9. `src/lib/claude/oauth-backend.ts` — same extension

`buildImagePromptStream` (`:47-70`) currently builds one image content block plus the text block for the single `image` param. Rename to `buildImagesPromptStream` and accept an array, fetching each image in parallel:
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
Call site (`:73`) becomes:
```ts
const images = params.images ?? (params.image ? [params.image] : [])
const prompt = images.length > 0 ? buildImagesPromptStream(params.prompt, images) : params.prompt
```
This backend is marked "currently unverified" in its own file header (`:1-8`) — this task does not attempt to verify or fix that, only extends it consistently with the api-key backend so `runStructured` behaves identically regardless of which backend is active. `condition-reassessment.ts` (Task 10) only ever runs through whichever backend `getClaudeBackend()` currently selects, same as every other call site — no new backend-selection logic needed.

### 10. `src/lib/inngest/functions/condition-reassessment.ts` — recalculation (new)

Mirrors the structure of `photo-quality-gate.ts` and the `runStep2VisionAnalysis` condition-extraction call in `step2-vision-analysis.ts` (`:97-98,109-110,207-282` for the existing schema shape/prompt conventions):
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
Register in `src/app/api/inngest/route.ts` alongside the other functions.

### 11. `src/types/listings.ts` — `condition_confirmed`

Add adjacent to the existing `photos_confirmed`/`skip_background_removal` fields (`:257-258`):
```ts
condition_confirmed: boolean;
```

### 12. Migration `supabase/migrations/0021_condition_confirmed.sql`

```sql
alter table listings
  add column condition_confirmed boolean not null default true;
```

Default `true` (not `false`) is deliberate: every existing listing today has never had a "pending approval" concept for condition at all, so backfilling them all as `false` would retroactively block every in-flight listing's Finalize step on a re-assessment they never asked for and that has no studio photos to run against yet in most cases. `true` treats existing data as already-implicitly-approved (matches how sub-project 1's inclusions backfill treated legacy `included: true` as `confirmed: true` — same "don't retroactively re-litigate old data" principle). The application code always writes `false` explicitly whenever a *new* recalculation runs (Task 10), so the pending state only ever appears going forward, on listings that actually go through the new flow.

### 13. `FieldsPanel.tsx` — QA-escalation banner + Condition section

**QA-escalation banner** replaces the plain block at `:514-519`. Needs a new client-side query for flagged photos — since `FieldsPanel` already receives `photos` as a prop (`FieldsPanelProps`, `:15-20`), no new data fetch is needed; filter in-component:
```tsx
const flaggedPhotos = photos.filter(
  (p) => p.type === 'studio' && (p.photoroom_meta as { quality_failed?: boolean } | null)?.quality_failed
)
```
Render, replacing `:514-519`:
```tsx
{listing.agent_blocked && flaggedPhotos.length > 0 && (
  <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5 space-y-3">
    <p className="text-xs font-medium text-orange-400">
      Agent waiting — {flaggedPhotos.length} photo{flaggedPhotos.length === 1 ? '' : 's'} need{flaggedPhotos.length === 1 ? 's' : ''} attention
    </p>
    {flaggedPhotos.map((photo) => (
      <QaChecklistRow key={photo.id} photo={photo} listingId={listing.id} />
    ))}
  </div>
)}
{listing.agent_blocked && flaggedPhotos.length === 0 && listing.agent_blocked_reason && (
  <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5">
    <p className="text-xs font-medium text-orange-400 mb-0.5">Agent waiting</p>
    <p className="text-xs text-orange-300/80">{listing.agent_blocked_reason}</p>
  </div>
)}
```
`QaChecklistRow` is a small new component (in the same file, following this file's existing convention of colocating small subcomponents like `AuthStepIcon`, `:39-43`):
- Idle state: thumbnail (`next/image`, `w-10 h-10 rounded border border-red-700`), the photo's `photoroom_meta.quality_verdict` text, a **Retake** button and a **Use as-is** button.
- **Retake** sets a `retakeTargetPhotoId` piece of state on the parent (lifted up, since the hidden file input lives at the `FieldsPanel`/page level today via `AgentChat`'s `fileInputRef` — this spec adds a second, dedicated hidden `<input type="file">` inside `FieldsPanel` itself scoped to this row's retake action, simpler than threading state up into `AgentChat`) and opens the file picker. On file selection, `POST`s to `/api/studio-upload` with `photo`, `listingId`, and `replacesPhotoId: photo.id` as `FormData`, then shows a "mid-retake" state (old thumbnail → new thumbnail, pulsing icon, "checking quality…") until the next `router.refresh()` (via the existing `AutoRefresh` 30s poll / focus-refresh) shows the row either gone (passed) or updated to the new photo's issue (failed again).
- **Use as-is** calls `PATCH /api/photos/${photo.id}/quality-override`, then relies on the same refresh cycle to clear the row.

**Condition section** replaces the read-only block at `:228-233`:
```tsx
{listing.condition && (
  listing.condition_confirmed ? (
    <div className="flex justify-between text-xs">
      <dt className="text-gray-600">Condition</dt>
      <dd className="text-gray-300">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd>
    </div>
  ) : (
    <section>
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Condition</h3>
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
          <button onClick={approveCondition} className="text-emerald-500 hover:text-emerald-400" title="Approve">
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  )
)}
```
`approveCondition` is a small new handler, same shape as the existing `confirmInclusion`/`saveInclusions` pattern (`:127-142`): `PATCH /api/listings/${listing.id}/condition` (new, minimal route — ownership-filtered update of `condition_confirmed: true`, plus `condition`/`condition_notes` if an edit form is added later; this spec's edit affordance is out of scope per the "Explicitly Out of Scope" section, matching how sub-project 1 left the Inclusions pencil button inert for its first pass).

### 14. Finalize gate

Current `src/app/api/listings/[id]/finalize/route.ts` (`:1-33`) does an ownership-checked `select`, then a conditional `update` scoped to `.eq('status', 'in_loop')` (a no-op, still-200 pattern if already past that status). Add the `condition_confirmed` check to the initial `select` and gate before the update:
```ts
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

### 15. bd `ai-listings-yva` update (not a code file)

Append to the ticket's acceptance criteria (via `bd update ai-listings-yva`, not a git commit): "Reconcile the interim Finalize-gate added by `ai-listings-e75` (`condition_confirmed` check in the finalize route, marked with an `INTERIM:` comment citing this ticket) — decide whether the real pricing gate subsumes it, replaces it, or it stays as a permanent invariant alongside pricing confirmation."

---

## Error Handling

- `reconcileQualityEscalation`/`supersedeReplacedPhoto`: pure DB operations, no external I/O — errors propagate as normal Inngest step failures (retried per the function's existing `retries: 1`), consistent with how the rest of `photo-quality-gate.ts` already handles step failures.
- `condition-reassessment.ts` follows the exact `ClaudeStructuredOutputError` handling convention already used in `step2-vision-analysis.ts` and `photo-quality-gate.ts` — rethrow with a `condition-reassessment:` prefix. If `urls.length === 0` (no studio photos, or listing not found), the function returns `{ok: false, ...}` without writing anything — no partial/garbage condition data, and no `agent_blocked` interaction since this path is independent of the QA-escalation flow.
- `quality-override` route: 401 unauthenticated, 404 for a non-owned or nonexistent photo (join-filtered `select`, matches the existing pattern where a failed ownership join returns no row rather than a separate 403).
- `confirm-photos` route: unchanged 401/500 shape; the ownership filter turns a cross-user PATCH into a silent no-op (zero rows), matching the precedent already established for `confirm-gender` and the inclusions route in sub-project 1 — consistent response shape across this codebase's owned-resource PATCH routes, not a new convention.
- Retake upload failures (network error, storage failure): the existing `/api/studio-upload` error responses (400/500) are unchanged; the client-side retake handler shows the existing row's idle state again on failure (no new photo created, nothing to supersede) rather than getting stuck in "checking quality…".

---

## Testing

- No new pure functions warrant a dedicated test file this time — the logic added (`reconcileQualityEscalation`, `supersedeReplacedPhoto`, the multi-image content-block builder) is either a thin DB query wrapper (no branching worth unit-testing in isolation from Supabase) or a 3-line loop extension of already-untested existing code (`buildUserContent`). This matches this repo's existing testing boundary: `src/lib/pipeline/**` and `src/lib/inngest/functions/**` have no test harness anywhere (live I/O against Claude/Supabase/Inngest), verified manually; `src/lib/**` pure-logic modules do (e.g. `inclusions.ts`, `ring-size.ts`).
- Manual smoke, quality-gate escalation: upload a deliberately bad studio photo (e.g. near-black); confirm the dashboard blocked-count increments, the workspace shows the checklist banner with a thumbnail and the specific issue, `Retake` opens the file picker and — after uploading a good replacement — the row disappears and `agent_blocked` clears (via `AutoRefresh`'s next poll) without any manual action; separately, confirm `Use as-is` on a flagged photo also clears it and the photo gets a `processed_url`.
- Manual smoke, two simultaneous flagged photos: confirm retaking one leaves the other's row and its specific issue untouched (validates the explicit `replacesPhotoId` linkage doesn't cross-wire).
- Manual smoke, condition recalculation: confirm processed photos on a listing with 2+ studio photos; confirm a new `condition`/`condition_notes` appears in `FieldsPanel` in the pending amber state; click Approve; confirm it collapses to the plain text state and persists across reload.
- Manual smoke, Finalize gate: attempt Finalize before condition is approved (expect the 400); approve; retry (expect success).
- `studio-photo-process.ts` removal: confirm a studio upload still gets its background removed exactly once (not skipped, not duplicated) by checking the `photos` row's `processed_url` and storage path after upload.

---

## Verification

1. `npx tsc --noEmit` clean (aside from the one known pre-existing unrelated error in `oauth-backend.ts`).
2. `npx eslint` on all changed files.
3. `npm test` — no regressions (this spec adds no new test files; existing suite count should be unchanged).
4. Migration applied via `kubectl exec -i -n sup-ai-listings ai-listings-supabase-db-0 -- psql -U postgres < supabase/migrations/0021_condition_confirmed.sql` (note the `-i` flag — see `AGENTS.md`), verified with a `SELECT` confirming existing rows show `condition_confirmed = true`.
5. All manual smoke scenarios above, against a real listing in dev.
6. `bd update ai-listings-yva` with the acceptance-criterion addition (Task 15) confirmed via `bd show ai-listings-yva`.
7. `bd close ai-listings-e75`; standard session-close git/bd push protocol.

---

## Explicitly Out of Scope

- **Condition edit UI** — approve-only in this pass; no form to correct a wrong recalculated condition inline (mirrors sub-project 1 leaving the Inclusions pencil/edit button inert for its first pass). If the recalculation is wrong, the existing chat-based "Wrong condition" suggestion (`inLoopContext`, already present) remains the correction path.
- **Retroactively recalculating condition for listings that reached `in_loop` before this ships** — `condition_confirmed` defaults to `true` for all existing rows (Task 12); no backfill job re-runs vision analysis on old listings.
- **The real pricing gate** — all of `ai-listings-yva`. This spec's Finalize block is explicitly interim (Task 14/15).
- **General manual photo deletion** — considered and rejected during brainstorming in favor of the auto-superseding Retake flow; no standalone "delete any photo" button is added.
- **Brand/category-specific condition assessment criteria** — the recalculation prompt is generic across categories, matching `step2-vision-analysis.ts`'s existing condition prompt, which is also category-agnostic today.
