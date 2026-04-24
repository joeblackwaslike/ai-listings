import Anthropic from '@anthropic-ai/sdk'
import { pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'
import type { AuthStep } from '@/types/listings'

interface AuthPlanOutput {
  steps: Array<{
    step: string
    guidance: string
    photo_required: boolean
  }>
  platform_auth_note: string
}

export async function runStep5AuthPlan(
  listingId: string,
  step2: Step2Result,
  suggestedPriceCents: number | null
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const priceNote =
    suggestedPriceCents && suggestedPriceCents >= 50000
      ? `Item is priced at ~$${(suggestedPriceCents / 100).toFixed(0)}, which is ≥$500. eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the sale for items at this price point — the platform bears the cost.`
      : `Item is priced below $500. Self-authentication using the checklist steps is required — platforms may not offer authentication at this price point.`

  const prompt = `Generate an authentication checklist for this luxury resale item.

Item:
- Brand: ${step2.brand}
- Category: ${step2.category}
- Condition: ${step2.condition}
- Features: ${step2.notableFeatures.join(', ')}

${priceNote}

Authentication requirements by brand:
- Chanel: Auth card serial number (12–14 digits, year lookup), hologram sticker placement, quilting pattern consistency, CC logo alignment, hardware gold/silver stamping
- Louis Vuitton: Date code format (letter+number series by factory/year), canvas condition assessment, "Louis Vuitton Paris" stamp, made-in label
- Christian Louboutin: Red sole condition (primary value driver), Loubi insole code (post-2011), leather quality, heel height accuracy
- Gucci: Serial number card (format varies by era), authenticity card, hardware, canvas/leather tells
- General luxury: Hardware stamping, lining quality, stitching consistency, brand stamp placement, date codes if applicable

Do NOT suggest Entrupy, Real Authentication, or other third-party authentication services.
For items ≥ $500: note eBay Authenticity Guarantee / Poshmark Posh Authenticate as the authentication layer.

Use the generate_auth_plan tool.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [
      {
        name: 'generate_auth_plan',
        description: 'Generate authentication checklist for a luxury item',
        input_schema: {
          type: 'object' as const,
          properties: {
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  step: { type: 'string', description: 'Short step name' },
                  guidance: {
                    type: 'string',
                    description: 'Specific guidance for this authentication step',
                  },
                  photo_required: {
                    type: 'boolean',
                    description: 'Whether a photo is needed to verify this step',
                  },
                },
                required: ['step', 'guidance', 'photo_required'],
              },
            },
            platform_auth_note: {
              type: 'string',
              description: 'Note about platform authentication eligibility',
            },
          },
          required: ['steps', 'platform_auth_note'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'generate_auth_plan' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step5: Claude did not return a tool_use block')
  }

  const output = toolUse.input as AuthPlanOutput

  const authPlan: AuthStep[] = output.steps.map((s) => ({
    step: s.step,
    guidance: s.guidance,
    status: 'pending',
    photo_required: s.photo_required,
  }))

  await pushPipelineStep(listingId, {
    pipeline_step: 5,
    auth_plan: authPlan,
  })
}
