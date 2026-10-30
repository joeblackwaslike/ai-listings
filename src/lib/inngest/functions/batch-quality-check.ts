import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { StudioBatchReadyEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { blockedUpdate } from '@/lib/pipeline/pipeline-end'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { ClaudeImageInput } from '@/lib/claude'
import { shotsToVerify, completePhotoResults } from '@/lib/pipeline/shot-verification'
import type { PhotoShot } from '@/types/listings'

interface PhotoResult {
  index: number
  passed: boolean
  issues: string[]
  verdict: string
  shot_index: number | null
}

interface BatchQualityOutput {
  results: PhotoResult[]
}

function shotListPrompt(plan: PhotoShot[]): string {
  if (plan.length === 0) return 'There is no shot list for this listing, so set shot_index to null for every photo.'
  const lines = plan.map((s, i) => `${i}. ${s.shot} — ${s.description}`)
  return `Shot list (0-based index. name — description):
${lines.join('\n')}

For each photo, also set shot_index to the index of the shot it shows, or null if it matches none.`
}

async function checkBatchQuality(
  photoUrls: string[],
  plan: PhotoShot[],
  apiKey: string | undefined
): Promise<BatchQualityOutput> {
  const images: ClaudeImageInput[] = await Promise.all(
    photoUrls.map(async (url) => ({ url: await toPublicUrl(url) }))
  )

  try {
    return await runStructured<BatchQualityOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
      images,
      apiKey,
      toolName: 'batch_quality_check',
      toolDescription: 'Evaluate all studio photos for resale listing quality in one pass',
      prompt: `These are all the studio photos for a resale listing (${photoUrls.length} total, in order). Evaluate each one for quality.

For each photo check:
1. Blur or motion blur — is the subject sharp?
2. Exposure — significantly underexposed (too dark) or overexposed (washed out)?
3. Subject framing — is the main item well-framed? Note: accessories like chains, straps, or cords that extend beyond the frame edges are acceptable — only fail framing if the item itself is cut off or obscured.
4. Multiple items in frame — are there multiple distinct items that should be separate listings?

Important: hands or fingers in the frame are acceptable and should never be flagged. Interior shots (zipper pockets, compartments, hardware details) often require a hand to hold the item open — that is expected and correct.

A photo passes if it is sharp, properly exposed, the main item is well-framed, and there is only one main item.

Return one result per photo using its 0-based index.

${shotListPrompt(plan)}`,
      jsonSchema: {
        type: 'object' as const,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number', description: '0-based index of the photo in the sequence' },
                passed: { type: 'boolean', description: 'True if photo is suitable for listing' },
                issues: { type: 'array', items: { type: 'string' }, description: 'Specific quality issues found' },
                verdict: { type: 'string', description: 'One-sentence summary' },
                shot_index: {
                  type: ['number', 'null'],
                  description: '0-based index into the shot list of the shot this photo shows, or null if none',
                },
              },
              required: ['index', 'passed', 'issues', 'verdict', 'shot_index'],
            },
          },
        },
        required: ['results'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('batch-quality-check: Claude did not return a tool_use block')
    }
    throw err
  }
}

async function markQualityChecked(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string,
  checkedAt: string
): Promise<void> {
  const { error } = await supabase
    .from('listings')
    .update({ quality_checked_at: checkedAt })
    .eq('id', listingId)
  if (error) throw new Error(`batch-quality-check: quality_checked_at update failed — ${error.message}`)
}

async function verifyShots(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string,
  shots: string[]
): Promise<void> {
  for (const shot of shots) {
    const { error } = await supabase.rpc('set_photo_shot_status', {
      p_listing_id: listingId,
      p_shot: shot,
      p_status: 'verified',
    })
    if (error && !/^shot not found/.test(error.message)) {
      throw new Error(`batch-quality-check: verifying shot "${shot}" failed — ${error.message}`)
    }
  }
}

export const batchQualityCheck = inngest.createFunction(
  {
    id: 'batch-quality-check',
    name: 'Batch Photo Quality Check',
    triggers: [{ event: 'listing/studio-batch-ready' }],
    retries: 1,
    concurrency: { limit: 1, key: 'event.data.listingId' },
  },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as StudioBatchReadyEvent).data
    const supabase = getSupabaseAdmin()

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, photo_plan')
      .eq('id', listingId)
      .single()

    if (!listingRow) return { ok: false, listingId, reason: 'listing not found' }

    // Memoized so replays keep the time from before the first photo query: a photo uploaded
    // while the check runs is newer than the stamp and keeps step 10 open.
    const checkedAt = await step.run('capture-check-start', () => new Date().toISOString())

    const { data: photos } = await supabase
      .from('photos')
      .select('id, processed_url, raw_url, photoroom_meta')
      .eq('listing_id', listingId)
      .eq('type', 'studio')
      .order('display_order', { ascending: true })

    if (!photos || photos.length === 0) return { ok: false, listingId, reason: 'no studio photos' }

    const photoUrls = photos.map((p) => ((p.processed_url ?? p.raw_url) as string))
    const apiKeys = await getUserApiKeys(listingRow.user_id)

    const plan = await step.run('capture-shot-list', () => (listingRow.photo_plan as PhotoShot[] | null) ?? [])

    const results = await step.run('check-quality-batch', async () => {
      const { results: raw } = await checkBatchQuality(photoUrls, plan, apiKeys.anthropic)
      return completePhotoResults(raw, photos.length)
    })

    const failed = await step.run('record-quality-results', async () => {
      const candidates = results.filter((r) => !r.passed)
      let stillFailed: PhotoResult[] = []

      if (candidates.length > 0) {
        // Re-read: a seller may have overridden a photo while the check ran.
        const { data: fresh, error: freshError } = await supabase
          .from('photos')
          .select('id, photoroom_meta')
          .in('id', candidates.map((r) => photos[r.index].id))
        if (freshError) throw new Error(`batch-quality-check: photo re-read failed — ${freshError.message}`)
        const overridden = new Set((fresh ?? []).filter((p) => p.photoroom_meta?.quality_overridden).map((p) => p.id))
        stillFailed = candidates.filter((r) => !overridden.has(photos[r.index].id))
      }

      if (stillFailed.length > 0) {
        const updates = await Promise.all(
          stillFailed.map((r) =>
            supabase
              .from('photos')
              .update({
                photoroom_meta: {
                  quality_failed: true,
                  quality_issues: r.issues,
                  quality_verdict: r.verdict,
                },
              })
              .eq('id', photos[r.index].id)
          )
        )
        const photoError = updates.find((u) => u.error)?.error
        if (photoError) throw new Error(`batch-quality-check: photo quality update failed — ${photoError.message}`)

        const { error: blockError } = await supabase
          .from('listings')
          .update({
            ...blockedUpdate('photo_quality', `${stillFailed.length} studio photo${stillFailed.length === 1 ? '' : 's'} need${stillFailed.length === 1 ? 's' : ''} attention — see the checklist below.`),
          })
          .eq('id', listingId)
        if (blockError) throw new Error(`batch-quality-check: listing block update failed — ${blockError.message}`)
      }

      await markQualityChecked(supabase, listingId, checkedAt)
      return stillFailed
    })
    const failedIndexes = new Set(failed.map((r) => r.index))

    // Last, and never fatal: a shot-status RPC failure must not undo the quality verdict above.
    await step.run('verify-shots', async () => {
      try {
        await verifyShots(
          supabase,
          listingId,
          shotsToVerify(plan, results.map((r) => ({ passed: !failedIndexes.has(r.index), shot_index: r.shot_index })))
        )
      } catch (err) {
        console.error(`[batch-quality-check] shot verification failed for listing ${listingId} (continuing):`, err)
      }
    })

    if (failed.length === 0) return { ok: true, listingId, checked: photos.length }

    return { ok: false, listingId, failed: failed.map((r) => ({ index: r.index, issues: r.issues })) }
  }
)
