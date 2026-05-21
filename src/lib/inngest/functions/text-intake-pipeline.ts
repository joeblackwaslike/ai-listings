import Anthropic from '@anthropic-ai/sdk'
import { inngest } from '../client'
import type { TextSubmittedEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin, pushPipelineStep } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { VisionAnalysis } from '@/lib/pipeline/step2-vision-analysis'
import type { ListingCategory, ConditionValue } from '@/types/listings'

const LUXURY_BRANDS = new Set([
  'Chanel',
  'Louis Vuitton',
  'Gucci',
  'Hermès',
  'Prada',
  'Balenciaga',
  'Christian Louboutin',
  'Dior',
  'Burberry',
  'Versace',
  'Saint Laurent',
  'Bottega Veneta',
  'Fendi',
  'Valentino',
  'Givenchy',
  'Movado',
  'Rolex',
  'Omega',
  'Cartier',
  'TAG Heuer',
  'Hublot',
  'Patek Philippe',
  'IWC',
  'Breguet',
  'Jaeger-LeCoultre',
])

type TextAnalysisOutput = {
  brand: string
  category: ListingCategory
  condition: ConditionValue
  condition_notes: string
  notable_features: string[]
  is_luxury: boolean
}

async function runTextAnalysis(
  listingId: string,
  description: string,
  brand: string | undefined,
  apiKeys: { anthropic: string },
): Promise<VisionAnalysis> {
  const client = new Anthropic({ apiKey: apiKeys.anthropic })

  const brandContext = brand ? ` The brand is "${brand}".` : ''
  const prompt = `You are analyzing a product description for a resale listing platform.${brandContext}

Product description: "${description}"

Use the extract_product_info tool to extract structured product information from this text description.
If condition is not determinable from the text, default to "good".
For notable_features, the FIRST entry MUST be "Model: <model name>" — use the most specific name identifiable from the description.`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    tools: [
      {
        name: 'extract_product_info',
        description: 'Extract structured product information from a text description',
        input_schema: {
          type: 'object' as const,
          properties: {
            brand: { type: 'string', description: 'Brand name (empty string if unknown)' },
            category: {
              type: 'string',
              enum: [
                'handbag',
                'small_leather_goods',
                'clothing',
                'sneakers',
                'electronics',
                'jewelry',
                'collectibles',
                'watches',
                'keyboards',
                'other',
              ],
            },
            condition: {
              type: 'string',
              enum: [
                'new_with_tags',
                'new_without_tags',
                'like_new',
                'very_good',
                'good',
                'fair',
                'poor',
                'for_parts',
              ],
            },
            condition_notes: {
              type: 'string',
              description: 'Specific condition details from the description',
            },
            notable_features: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Key attributes. First entry MUST be "Model: <model name>". Then add color, size, etc.',
            },
            is_luxury: {
              type: 'boolean',
              description: 'Whether this is a luxury brand item',
            },
          },
          required: [
            'brand',
            'category',
            'condition',
            'condition_notes',
            'notable_features',
            'is_luxury',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_product_info' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('text-analysis: Claude did not return a tool_use block')
  }

  const output = toolUse.input as TextAnalysisOutput
  const resolvedBrand = brand ?? output.brand
  const isLuxury = LUXURY_BRANDS.has(resolvedBrand) || output.is_luxury

  await pushPipelineStep(listingId, {
    pipeline_step: 2,
    status: 'in_loop',
    brand: resolvedBrand,
    category: output.category,
    condition: output.condition,
    condition_notes: output.condition_notes,
    is_luxury: isLuxury,
    inclusions: [],
    photo_plan: [],
    intake_meta: {
      textAnalysis: output,
      source: 'text',
    },
  })

  return {
    ok: true,
    brand: resolvedBrand,
    category: output.category,
    condition: output.condition,
    conditionNotes: output.condition_notes,
    notableFeatures: output.notable_features,
    isLuxury,
    inclusions: [],
    photoPlan: [],
    confidenceNote: 'Text-based analysis — no photo available',
  }
}

export const textIntakePipeline = inngest.createFunction(
  {
    id: 'text-intake-pipeline',
    name: 'Text Intake Pipeline',
    triggers: [{ event: 'text/submitted' }],
    retries: 3,
    onFailure: async ({ error, event }) => {
      const { listingId } = (
        event as unknown as { data: { event: TextSubmittedEvent } }
      ).data.event.data
      const reason = error.message || 'Unknown pipeline error'

      let userMessage: string
      if (reason.includes('ECONNREFUSED') || reason.includes('fetch failed')) {
        userMessage = 'Could not reach an external service — try again shortly'
      } else {
        const stepMatch = reason.match(/^(step\d+\w*):/i)
        const stepLabel = stepMatch ? stepMatch[1] : 'pipeline'
        userMessage = `${stepLabel} failed — ${reason.substring(0, 150)}`
      }

      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({
          status: 'in_loop',
          agent_blocked: true,
          agent_blocked_reason: userMessage,
        })
        .eq('id', listingId)
    },
  },
  async ({ event, step }) => {
    const { listingId, productData } = (event as unknown as TextSubmittedEvent).data
    const { description, brand, imageUrl } = productData

    const apiKeys = await step.run('fetch-api-keys', async () => {
      const supabase = getSupabaseAdmin()
      const { data: listingRow } = await supabase
        .from('listings')
        .select('user_id')
        .eq('id', listingId)
        .single()
      return getUserApiKeys(listingRow?.user_id ?? null)
    })

    // Step 2: text analysis
    const step2Result = await step.run('text-analysis', () =>
      runTextAnalysis(listingId, description, brand, apiKeys)
    )

    const titleForComps = (step2Result.notableFeatures[0] ?? '').replace(/^Model:\s*/i, '').trim()

    // Step 3: pricing research
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps, apiKeys)
    )

    const supabase = getSupabaseAdmin()
    const { data: listingAfterStep3 } = await supabase
      .from('listings')
      .select('suggested_price_cents')
      .eq('id', listingId)
      .single()
    const suggestedPriceCents: number | null =
      listingAfterStep3?.suggested_price_cents ?? null

    // Step 4a: draft listing
    await step.run('draft-listing', () =>
      runStep4aDraftListing(listingId, step2Result, suggestedPriceCents, apiKeys)
    )

    // Step 5: auth plan (luxury only)
    if (step2Result.isLuxury) {
      await step.run('auth-plan', () =>
        runStep5AuthPlan(listingId, step2Result, suggestedPriceCents, apiKeys)
      )
    }

    await pushPipelineStep(listingId, {
      status: 'in_loop',
      pipeline_total: 4,
      agent_blocked: false,
      agent_blocked_reason: null,
    })

    return { ok: true, listingId, status: 'in_loop' }
  }
)
