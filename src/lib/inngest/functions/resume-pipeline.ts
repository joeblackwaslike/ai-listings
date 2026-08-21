import { inngest } from '../client'
import type { PipelineResumeEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin, pushPipelineStep } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'

// Drives a listing through every remaining step (3, then 4, then 5 if luxury) and lands it
// on status:'in_loop', instead of retry-step's single-step-at-a-time retry. Exists because
// a listing whose original intake-pipeline run died mid-flight (orphaned Inngest run, no
// live waitForEvent left to resume) previously required calling pipeline/retry-step three
// times by hand plus a manual status patch to actually finish it (ai-listings dashboard
// report, 2026-08-21 -- "why isn't there a restart pipeline call that doesn't require this
// degree of handholding"). Only handles listings already past id-gate/gender-gate
// (pipeline_step >= 2); a listing that never got that far has no gate answers to preserve
// and should go through a full restart (photo/uploaded) instead.
export const resumePipeline = inngest.createFunction(
  {
    id: 'resume-pipeline',
    name: 'Resume Pipeline',
    triggers: [{ event: 'pipeline/resume' }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as PipelineResumeEvent).data

    const supabase = getSupabaseAdmin()
    const { data: listing } = await supabase
      .from('listings')
      .select(
        'user_id, category, brand, condition, is_luxury, suggested_price_cents, intake_meta, pipeline_step'
      )
      .eq('id', listingId)
      .single()

    if (!listing) {
      throw new Error(`resume-pipeline: listing ${listingId} not found`)
    }

    const startStep = (listing.pipeline_step as number | null) ?? 0
    if (startStep < 2) {
      throw new Error(
        `resume-pipeline: listing ${listingId} is only at step ${startStep} -- id-gate/vision hasn't completed, use a full restart (photo/uploaded) instead`
      )
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

    if (startStep < 3) {
      await step.run('resume-pricing-research', () =>
        runStep3PricingResearch(
          listingId,
          step2Partial as unknown as Parameters<typeof runStep3PricingResearch>[1],
          '',
          apiKeys
        )
      )
    }

    if (startStep < 4) {
      await Promise.all([
        step.run('resume-draft-listing', () =>
          runStep4aDraftListing(
            listingId,
            step2Partial as unknown as Parameters<typeof runStep4aDraftListing>[1],
            listing.suggested_price_cents as number | null,
            apiKeys
          )
        ),
        step.run('resume-photoroom', () =>
          runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys)
        ),
      ])
    }

    const isLuxury = listing.is_luxury as boolean
    if (isLuxury && startStep < 5) {
      await step.run('resume-auth-plan', () =>
        runStep5AuthPlan(
          listingId,
          step2Partial as unknown as Parameters<typeof runStep5AuthPlan>[1],
          listing.suggested_price_cents as number | null,
          apiKeys
        )
      )
    }

    await pushPipelineStep(listingId, {
      status: 'in_loop',
      pipeline_total: isLuxury ? 5 : 4,
      agent_blocked: false,
      agent_blocked_reason: null,
    })

    return { ok: true, listingId, status: 'in_loop' }
  }
)
