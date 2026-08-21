import { inngest } from '../client'
import type { PipelineRetryStepEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'
import { notableFeaturesOf } from '@/lib/pipeline/gate-messages'

export const retryStep = inngest.createFunction(
  {
    id: 'retry-step',
    name: 'Retry Pipeline Step',
    triggers: [{ event: 'pipeline/retry-step' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, step: stepNum } = (
      event as unknown as PipelineRetryStepEvent
    ).data

    const supabase = getSupabaseAdmin()
    const { data: listing } = await supabase
      .from('listings')
      .select(
        'user_id, category, brand, condition, is_luxury, suggested_price_cents, intake_meta'
      )
      .eq('id', listingId)
      .single()

    if (!listing) {
      throw new Error(`retry-step: listing ${listingId} not found`)
    }

    const apiKeys = await step.run('fetch-api-keys', () =>
      getUserApiKeys(listing.user_id as string | null)
    )

    const { data: photoRow } = await supabase
      .from('photos')
      .select('id, raw_url')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .single()

    const photoUrl: string = (photoRow?.raw_url as string | null) ?? ''
    const intakePhotoId: string = (photoRow?.id as string | null) ?? ''

    // Reconstructed from stored vision-analysis output, not left empty -- hardcoding
    // notableFeatures/titleForComps to [] / '' starved both the draft title and the
    // comp-search query of every brand/model/collab detail the original vision pass found,
    // silently degrading a retried listing's title to a generic fallback and its comps to
    // near-zero (OT-0026, ai-listings dashboard report, 2026-08-21 -- Gucci x Doraemon collab
    // collapsed to "Gucci Women's Sneakers").
    const visionOutput = (listing.intake_meta as Record<string, unknown> | null)?.visionAnalysis as
      | { condition_notes?: string; confidence_note?: string }
      | undefined
    const notableFeatures = notableFeaturesOf(listing.intake_meta as Record<string, unknown> | null)
    const step2Partial = {
      brand: (listing.brand as string) ?? '',
      category: listing.category,
      condition: listing.condition,
      conditionNotes: visionOutput?.condition_notes ?? '',
      notableFeatures,
      isLuxury: listing.is_luxury as boolean,
      inclusions: [],
      photoPlan: [],
      confidenceNote: visionOutput?.confidence_note ?? '',
    }
    const titleForComps = (notableFeatures[0] ?? '').replace(/^Model:\s*/i, '').trim()

    if (stepNum === 3) {
      await step.run('retry-pricing-research', () =>
        runStep3PricingResearch(listingId, step2Partial as unknown as Parameters<typeof runStep3PricingResearch>[1], titleForComps, apiKeys)
      )
    } else if (stepNum === 4) {
      await Promise.all([
        step.run('retry-draft-listing', () =>
          runStep4aDraftListing(
            listingId,
            step2Partial as unknown as Parameters<typeof runStep4aDraftListing>[1],
            listing.suggested_price_cents as number | null,
            apiKeys
          )
        ),
        step.run('retry-photoroom', () =>
          runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys)
        ),
      ])
    } else if (stepNum === 5) {
      await step.run('retry-auth-plan', () =>
        runStep5AuthPlan(
          listingId,
          step2Partial as unknown as Parameters<typeof runStep5AuthPlan>[1],
          listing.suggested_price_cents as number | null,
          apiKeys
        )
      )
    } else {
      throw new Error(`retry-step: step ${stepNum} cannot be retried independently (steps 1 and 2 restart the full pipeline)`)
    }

    await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', listingId)

    return { ok: true, listingId, retriedStep: stepNum }
  }
)
