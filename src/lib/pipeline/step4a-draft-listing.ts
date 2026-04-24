import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'

interface DraftOutput {
  canonical_title: string
  canonical_description: string
  ebay_title: string
  ebay_description: string
  ebay_category_id: string
  ebay_item_specifics: Record<string, string>
  poshmark_title: string
  poshmark_description: string
  poshmark_category: string
  poshmark_size: string
  suggested_price_cents: number
  seo_keywords: string[]
}

export async function runStep4aDraftListing(
  listingId: string,
  step2: Step2Result,
  suggestedPriceCents: number | null
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const supabase = getSupabaseAdmin()

  const { data: comps } = await supabase
    .from('pricing_comps')
    .select('source, title, sale_price_cents, condition, condition_delta, adjusted_price_cents')
    .eq('listing_id', listingId)
    .order('adjusted_price_cents')
    .limit(8)

  const compsText =
    comps && comps.length > 0
      ? comps
          .map(
            (c) =>
              `${c.source}: "${c.title}" — $${(c.adjusted_price_cents / 100).toFixed(0)} adjusted (${c.condition}, ${c.condition_delta} condition)`
          )
          .join('\n')
      : 'No comps available'

  const priceHint = suggestedPriceCents
    ? `Suggested price from comps: $${(suggestedPriceCents / 100).toFixed(0)}.`
    : 'No pricing data available — suggest a reasonable price.'

  const prompt = `Generate a complete resale listing for this item.

Item details:
- Brand: ${step2.brand}
- Category: ${step2.category}
- Condition: ${step2.condition}
- Condition notes: ${step2.conditionNotes}
- Notable features: ${step2.notableFeatures.join(', ')}
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}

Comparable sold prices:
${compsText}

${priceHint}

Use the generate_listing tool to produce the full listing.

Rules:
- Canonical title: brand + model + key attributes, not platform-specific
- eBay title: exactly 80 chars or fewer, keyword-rich (buyers search "Chanel Classic Flap Medium Black Gold Hardware")
- Poshmark title: natural, 60 chars max
- eBay item specifics: brand, style/model, color, material, condition, size/dimensions where relevant
- eBay category_id: use standard eBay category ID numbers (Handbags: 169291, Sneakers: 155202, Electronics/phones: 9355, Clothing tops: 53159)
- Descriptions should be factual, buyer-oriented, no filler phrases like "don't miss out"`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    tools: [
      {
        name: 'generate_listing',
        description: 'Generate all listing fields for a resale item',
        input_schema: {
          type: 'object' as const,
          properties: {
            canonical_title: { type: 'string' },
            canonical_description: { type: 'string' },
            ebay_title: {
              type: 'string',
              description: 'Max 80 characters, keyword-optimized',
            },
            ebay_description: { type: 'string' },
            ebay_category_id: { type: 'string' },
            ebay_item_specifics: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            poshmark_title: { type: 'string', description: 'Max 60 characters' },
            poshmark_description: { type: 'string' },
            poshmark_category: { type: 'string' },
            poshmark_size: { type: 'string' },
            suggested_price_cents: {
              type: 'integer',
              description: 'Suggested listing price in cents',
            },
            seo_keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Top 10 search keywords buyers use for this item',
            },
          },
          required: [
            'canonical_title',
            'canonical_description',
            'ebay_title',
            'ebay_description',
            'ebay_category_id',
            'ebay_item_specifics',
            'poshmark_title',
            'poshmark_description',
            'poshmark_category',
            'poshmark_size',
            'suggested_price_cents',
            'seo_keywords',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'generate_listing' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step4a: Claude did not return a tool_use block')
  }

  const draft = toolUse.input as DraftOutput

  await pushPipelineStep(listingId, {
    pipeline_step: 4,
    title: draft.canonical_title,
    description: draft.canonical_description,
    suggested_price_cents: draft.suggested_price_cents,
    platform_fields: {
      ebay: {
        title: draft.ebay_title,
        description: draft.ebay_description,
        category_id: draft.ebay_category_id,
        item_specifics: draft.ebay_item_specifics,
        condition_id: step2.condition,
      },
      poshmark: {
        title: draft.poshmark_title,
        description: draft.poshmark_description,
        category: draft.poshmark_category,
        size: draft.poshmark_size,
      },
    },
  })
}
