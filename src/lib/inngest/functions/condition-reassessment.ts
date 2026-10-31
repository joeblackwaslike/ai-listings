import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { ListingPhotosConfirmedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { ClaudeImageInput } from '@/lib/claude'
import type { ConditionValue } from '@/types/listings'

const SKIP_STATUSES = ['published', 'sold', 'archived', 'intake', 'id_gate', 'gender_gate'] as const

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
      prompt: `These are all the studio photos for this resale listing, taken after background removal/review. Reassess the item's physical condition using everything visible across all of them.

Focus exclusively on the physical state of the item itself: surface wear, scuffing, scratches, staining, fading, hardware condition, structural integrity, and any defects visible in the photos. Do NOT describe, infer, or claim anything about accessories, included items, completeness, or what "comes with" the item — those details are not visible in studio photos and must not be assumed.

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
  {
    id: 'condition-reassessment',
    name: 'Condition Re-assessment',
    triggers: [{ event: 'listing/photos-confirmed' }],
    retries: 1,
    debounce: { period: '30s', key: 'event.data.listingId' },
    concurrency: { limit: 1, key: 'event.data.listingId' },
    // Without the reassessment the listing would sit in in_loop with photos confirmed and no way
    // into copy review; review the condition already on file instead.
    onFailure: async ({ event }) => {
      const { listingId } = (event as unknown as { data: { event: ListingPhotosConfirmedEvent } }).data.event.data
      const { error } = await getSupabaseAdmin()
        .from('listings')
        .update({ condition_confirmed: false, status: 'condition_gate' })
        .eq('id', listingId)
        .eq('status', 'in_loop')
        .eq('photos_confirmed', true)
      if (error) console.error(`[condition-reassessment] onFailure: failed to open condition_gate for listing ${listingId}`, error)
    },
  },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as ListingPhotosConfirmedEvent).data
    const supabase = getSupabaseAdmin()

    const result = await step.run('reassess-condition', async () => {
      const { data: listingRow, error: listingError } = await supabase
        .from('listings')
        .select('user_id')
        .eq('id', listingId)
        .single()
      if (listingError) throw new Error(`condition-reassessment: failed to load listing ${listingId} -- ${listingError.message}`)
      if (!listingRow) return null

      const { data: photos, error: photosError } = await supabase
        .from('photos')
        .select('processed_url, raw_url')
        .eq('listing_id', listingId)
        .eq('type', 'studio')
      if (photosError) throw new Error(`condition-reassessment: failed to load photos for listing ${listingId} -- ${photosError.message}`)

      const urls = (photos ?? [])
        .map((p) => (p.processed_url ?? p.raw_url) as string)
        .filter(Boolean)
      if (urls.length === 0) return null

      const apiKeys = await getUserApiKeys(listingRow.user_id)
      const output = await reassessCondition(urls, apiKeys.anthropic)
      return { condition: output.condition, condition_notes: output.condition_notes }
    })

    if (!result) return { ok: false, listingId, reason: 'no studio photos or listing not found' }

    // Single atomic write: condition fields + status transition together.
    // Published, sold and archived listings are settled; photos confirmed after that point
    // shouldn't reopen the workflow. A listing still at intake or a pre-photo gate is left alone
    // too: its pipeline end lands it in condition_gate once photos are confirmed. Any other
    // status (in_loop, condition_gate, copy_review, finalizing) transitions to condition_gate so
    // the seller can confirm the reassessed condition before proceeding.
    const { data: updatedRow, error: updateError } = await supabase
      .from('listings')
      .update({ condition: result.condition, condition_notes: result.condition_notes, condition_confirmed: false, status: 'condition_gate' })
      .eq('id', listingId)
      .not('status', 'in', `(${SKIP_STATUSES.join(',')})`)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error(`condition-reassessment: failed to set condition_gate for listing ${listingId} -- ${updateError.message}`)
    }
    if (!updatedRow) {
      console.warn(`[condition-reassessment] listing ${listingId} is ${SKIP_STATUSES.join('/')} — condition_gate transition skipped`)
    }

    return { ok: true, listingId }
  }
)
