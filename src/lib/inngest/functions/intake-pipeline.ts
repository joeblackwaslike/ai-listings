import { inngest } from '../client'
import type { PhotoUploadedEvent } from '../client'
import { runStep1ProductId } from '@/lib/pipeline/step1-product-id'
import { runStep2VisionAnalysis } from '@/lib/pipeline/step2-vision-analysis'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin, pushPipelineStep } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'

export const intakePipeline = inngest.createFunction(
  {
    id: 'intake-pipeline',
    name: 'Intake Pipeline',
    triggers: [{ event: 'photo/uploaded' }],
    retries: 3,
    onFailure: async ({ error, event }) => {
      const { listingId } = (
        event as unknown as { data: { event: PhotoUploadedEvent } }
      ).data.event.data
      const reason = error.message || 'Unknown pipeline error'

      const stepMatch = reason.match(/^(step\d+\w*):/i)
      const stepLabel = stepMatch ? stepMatch[1] : 'pipeline'

      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({
          status: 'in_loop',
          agent_blocked: true,
          agent_blocked_reason: `${stepLabel} failed after retries — ${reason.substring(0, 200)}`,
        })
        .eq('id', listingId)
    },
  },
  async ({ event, step }) => {
    const { listingId, photoUrl } = (event as unknown as PhotoUploadedEvent).data

    const supabase = getSupabaseAdmin()
    const { data: photoRow } = await supabase
      .from('photos')
      .select('id')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .single()
    const intakePhotoId: string = photoRow?.id ?? ''

    const apiKeys = await step.run('fetch-api-keys', async () => {
      const { data: listingRow } = await supabase
        .from('listings')
        .select('user_id')
        .eq('id', listingId)
        .single()
      return getUserApiKeys(listingRow?.user_id ?? null)
    })

    const step1Result = await step.run('product-id', () =>
      runStep1ProductId(listingId, photoUrl, apiKeys)
    )

    let step2Result = await step.run('vision-analysis', () =>
      runStep2VisionAnalysis(listingId, photoUrl, step1Result, null, apiKeys)
    )

    let gateAttempt = 0
    while (gateAttempt < 3) {
      const confirmation = await step.waitForEvent(`id-gate-confirm-${gateAttempt}`, {
        event: 'pipeline/id-confirmed',
        timeout: '7d',
        match: 'data.listingId',
      })

      if (confirmation === null) break

      if (
        (confirmation as unknown as { data: { confirmed: boolean } }).data.confirmed
      ) {
        break
      }

      const corrections = (
        confirmation as unknown as { data: { corrections: string | null } }
      ).data.corrections

      step2Result = await step.run(`re-identify-${gateAttempt}`, () =>
        runStep2VisionAnalysis(listingId, photoUrl, step1Result, corrections, apiKeys)
      )

      gateAttempt++
    }

    const titleForComps = step2Result.notableFeatures.slice(0, 3).join(' ')
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps, apiKeys)
    )

    const { data: listingAfterStep3 } = await supabase
      .from('listings')
      .select('suggested_price_cents')
      .eq('id', listingId)
      .single()
    const suggestedPriceCents: number | null =
      listingAfterStep3?.suggested_price_cents ?? null

    await Promise.all([
      step.run('draft-listing', () =>
        runStep4aDraftListing(listingId, step2Result, suggestedPriceCents, apiKeys)
      ),
      step.run('photoroom-process', () =>
        runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys)
      ),
    ])

    if (step2Result.isLuxury) {
      await step.run('auth-plan', () =>
        runStep5AuthPlan(listingId, step2Result, suggestedPriceCents, apiKeys)
      )
    }

    const totalSteps = step2Result.isLuxury ? 5 : 4
    await pushPipelineStep(listingId, {
      status: 'in_loop',
      pipeline_total: totalSteps,
      agent_blocked: false,
      agent_blocked_reason: null,
    })

    return { ok: true, listingId, status: 'in_loop' }
  }
)
