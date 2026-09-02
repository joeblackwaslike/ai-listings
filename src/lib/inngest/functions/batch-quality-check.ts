import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { ListingPhotosConfirmedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { ClaudeImageInput } from '@/lib/claude'

interface PhotoResult {
  index: number
  passed: boolean
  issues: string[]
  verdict: string
}

interface BatchQualityOutput {
  results: PhotoResult[]
}

async function checkBatchQuality(photoUrls: string[], apiKey: string | undefined): Promise<BatchQualityOutput> {
  const images: ClaudeImageInput[] = await Promise.all(
    photoUrls.map(async (url) => ({ url: await toPublicUrl(url) }))
  )

  try {
    return await runStructured<BatchQualityOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
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

Return one result per photo using its 0-based index.`,
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
              },
              required: ['index', 'passed', 'issues', 'verdict'],
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

export const batchQualityCheck = inngest.createFunction(
  {
    id: 'batch-quality-check',
    name: 'Batch Photo Quality Check',
    triggers: [{ event: 'listing/photos-confirmed' }],
    retries: 1,
    concurrency: { limit: 1, key: 'event.data.listingId' },
  },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as ListingPhotosConfirmedEvent).data
    const supabase = getSupabaseAdmin()

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id')
      .eq('id', listingId)
      .single()

    if (!listingRow) return { ok: false, listingId, reason: 'listing not found' }

    const { data: photos } = await supabase
      .from('photos')
      .select('id, processed_url, raw_url')
      .eq('listing_id', listingId)
      .eq('type', 'studio')
      .order('display_order', { ascending: true })

    if (!photos || photos.length === 0) return { ok: false, listingId, reason: 'no studio photos' }

    const photoUrls = photos.map((p) => ((p.processed_url ?? p.raw_url) as string))
    const apiKeys = await getUserApiKeys(listingRow.user_id)

    const { results } = await step.run('check-quality-batch', () =>
      checkBatchQuality(photoUrls, apiKeys.anthropic)
    )

    const failed = results.filter((r) => !r.passed)

    if (failed.length === 0) return { ok: true, listingId, checked: photos.length }

    // Mark failed photos
    await Promise.all(
      failed.map((r) => {
        const photo = photos[r.index]
        if (!photo) return Promise.resolve()
        return supabase
          .from('photos')
          .update({
            photoroom_meta: {
              quality_failed: true,
              quality_issues: r.issues,
              quality_verdict: r.verdict,
            },
          })
          .eq('id', photo.id)
      })
    )

    await supabase
      .from('listings')
      .update({
        agent_blocked: true,
        agent_blocked_reason: `${failed.length} studio photo${failed.length === 1 ? '' : 's'} need${failed.length === 1 ? 's' : ''} attention — see the checklist below.`,
      })
      .eq('id', listingId)

    return { ok: false, listingId, failed: failed.map((r) => ({ index: r.index, issues: r.issues })) }
  }
)
