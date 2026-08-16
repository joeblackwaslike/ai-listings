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
import { detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { classifyJewelrySubTypeWithLlm } from '@/lib/jewelry-llm-fallback'
import { computeEstimatedShippingBox } from '@/lib/sizing/shipping-box'
import { deriveShoeUsSizeForStorage } from '@/lib/sizing/shoe-conversion'
import type { ClothingSubType, JewelrySubType, Measurements } from '@/types/listings'

export const intakePipeline = inngest.createFunction(
  {
    id: 'intake-pipeline',
    name: 'Intake Pipeline',
    triggers: [{ event: 'photo/uploaded' }],
    retries: 5,
    // Capped at 2: each concurrent run does Claude Vision + image handling for a
    // single item, which is memory-heavy on this cluster's resource-constrained
    // Pi node. A batch upload of 4 items running fully in parallel (the old
    // limit) OOM-killed the pod (2026-08-15 incident) -- this bounds per-pod
    // memory use regardless of how many items get uploaded in one batch.
    concurrency: { limit: 2 },
    onFailure: async ({ error, event }) => {
      const { listingId } = (
        event as unknown as { data: { event: PhotoUploadedEvent } }
      ).data.event.data
      const reason = error.message || 'Unknown pipeline error'

      let userMessage: string
      if (reason.includes('invalid or unsupported') || reason.includes('base64.data') || reason.includes('file format')) {
        userMessage = 'Photo format not supported — re-upload as JPEG or PNG'
      } else if (reason.includes('529') || reason.toLowerCase().includes('overloaded')) {
        userMessage = 'AI API temporarily overloaded — all retries exhausted. Re-upload this item to try again.'
      } else if (reason.includes('ECONNREFUSED') || reason.includes('fetch failed')) {
        userMessage = 'Could not reach an external service — try again shortly'
      } else {
        const stepMatch = reason.match(/^(step\d+\w*):/i)
        const stepLabel = stepMatch ? stepMatch[1] : 'pipeline'
        userMessage = `${stepLabel} failed — ${reason.substring(0, 150)}`
      }

      const supabase = getSupabaseAdmin()
      // Don't un-archive a listing the user archived while this run was still in flight
      // (queued, mid-retry) — see supabase-push.ts's pushPipelineStep for the same guard
      // on the success path.
      await supabase
        .from('listings')
        .update({
          status: 'in_loop',
          agent_blocked: true,
          agent_blocked_reason: userMessage,
        })
        .eq('id', listingId)
        .neq('status', 'archived')
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
      runStep2VisionAnalysis(listingId, photoUrl, step1Result, apiKeys, null)
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
        runStep2VisionAnalysis(listingId, photoUrl, step1Result, apiKeys, corrections)
      )

      gateAttempt++
    }

    const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])
    const needsGender = GENDER_CATEGORIES.has(step2Result.category?.toLowerCase() ?? '')

    let gender: string | null = null
    let measurements: Record<string, unknown> | null = null

    // All categories pause here to collect measurements (and gender for clothing/sneakers/watches)
    await step.run('gender-gate-start', () =>
      supabase.from('listings').update({ status: 'gender_gate' }).eq('id', listingId).neq('status', 'archived')
    )

    const genderConfirmation = await step.waitForEvent('gender-gate-confirm', {
      event: 'pipeline/gender-confirmed',
      timeout: '7d',
      match: 'data.listingId',
    })

    if (genderConfirmation) {
      const gd = (genderConfirmation as unknown as {
        data: { gender?: string; measurements?: Record<string, unknown> | null }
      }).data
      gender = needsGender ? (gd.gender ?? null) : null
      measurements = gd.measurements ?? null

      const category = (step2Result.category ?? '').toLowerCase()
      const subType: ClothingSubType | JewelrySubType | null =
        category === 'clothing' ? detectClothingSubType(step2Result.notableFeatures)
        : category === 'jewelry' ? detectJewelrySubType(step2Result.notableFeatures)
        : null

      const shoeSizeMeasurements = deriveShoeUsSizeForStorage({
        category,
        gender,
        brand: step2Result.brand,
        measurements,
      })
      if (shoeSizeMeasurements) {
        measurements = shoeSizeMeasurements
      }

      const estimatedShippingBox = computeEstimatedShippingBox(category, measurements as Measurements | null)
      const measurementsWithShippingBox = estimatedShippingBox
        ? { ...measurements, estimated_shipping_box: estimatedShippingBox }
        : measurements

      await step.run('store-gender', () =>
        supabase.from('listings').update({ gender, measurements: measurementsWithShippingBox, sub_type: subType }).eq('id', listingId)
      )

      if (subType === null && category === 'jewelry') {
        await step.run('jewelry-subtype-llm-fallback', async () => {
          // Best-effort, deliberately non-fatal: a failed classification here would
          // otherwise mark the whole listing agent_blocked via onFailure, which isn't
          // warranted for a nice-to-have enrichment.
          try {
            const llmSubType = await classifyJewelrySubTypeWithLlm(step2Result.notableFeatures, apiKeys)
            if (llmSubType) {
              await supabase.from('listings').update({ sub_type: llmSubType }).eq('id', listingId)
            }
          } catch (err) {
            console.error('jewelry-subtype-llm-fallback failed for listing', listingId, err)
          }
        })
      }
    }

    const titleForComps = (step2Result.notableFeatures[0] ?? '').replace(/^Model:\s*/i, '').trim()
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps, apiKeys, gender)
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
        runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys, step2Result.category)
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
