import { inngest } from '../client'
import type { PipelineRetryStepEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

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
        'category, brand, condition, is_luxury, suggested_price_cents, intake_meta'
      )
      .eq('id', listingId)
      .single()

    if (!listing) {
      throw new Error(`retry-step: listing ${listingId} not found`)
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .select('id, raw_url')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .single()

    const photoUrl: string = (photoRow?.raw_url as string | null) ?? ''
    const intakePhotoId: string = (photoRow?.id as string | null) ?? ''

    const step2Partial = {
      brand: (listing.brand as string) ?? '',
      category: listing.category,
      condition: listing.condition,
      conditionNotes: '',
      notableFeatures: [],
      isLuxury: listing.is_luxury as boolean,
      inclusions: [],
      photoPlan: [],
      confidenceNote: '',
    }

    if (stepNum === 3) {
      await step.run('retry-pricing-research', () =>
        runStep3PricingResearch(listingId, step2Partial as unknown as Parameters<typeof runStep3PricingResearch>[1], '')
      )
    } else if (stepNum === 4) {
      await Promise.all([
        step.run('retry-draft-listing', () =>
          runStep4aDraftListing(
            listingId,
            step2Partial as unknown as Parameters<typeof runStep4aDraftListing>[1],
            listing.suggested_price_cents as number | null
          )
        ),
        step.run('retry-photoroom', () =>
          runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId)
        ),
      ])
    } else if (stepNum === 5) {
      await step.run('retry-auth-plan', () =>
        runStep5AuthPlan(
          listingId,
          step2Partial as unknown as Parameters<typeof runStep5AuthPlan>[1],
          listing.suggested_price_cents as number | null
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
