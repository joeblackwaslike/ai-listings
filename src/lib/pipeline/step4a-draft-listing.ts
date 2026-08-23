import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { VisionAnalysis } from './step2-vision-analysis'
import type { ApiKeys } from '@/lib/user-api-keys'
import { getPlatformRules } from '@/lib/platform-rules'
import { getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import { buildShoeSizingPromptSection } from '@/lib/sizing/shoe-conversion'
import type { ClothingSubType, JewelrySubType } from '@/types/listings'

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
  step2: VisionAnalysis,
  suggestedPriceCents: number | null,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Re-running draft generation must not regress the pipeline_step counter below
  // wherever the listing already is (e.g. a listing that already completed step5)
  // -- same class of bug as step3-pricing-research.ts, fixed there 2026-08-23.
  const { data: currentListing } = await supabase
    .from('listings')
    .select('pipeline_step')
    .eq('id', listingId)
    .single()
  const pipelineStepFloor = Math.max((currentListing?.pipeline_step as number | null) ?? 0, 4)

  // Fetch listing's user_id for rules lookup
  let rulesSection = ''
  try {
    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id')
      .eq('id', listingId)
      .single()

    if (listingRow?.user_id) {
      const rules = await getPlatformRules(listingRow.user_id as string, ['ebay', 'poshmark'])
      const parts: string[] = []
      if (rules['ebay']) {
        parts.push(`[eBay listing rules — excerpt]\n${rules['ebay'].slice(0, 1500)}`)
      }
      if (rules['poshmark']) {
        parts.push(`[Poshmark listing rules — excerpt]\n${rules['poshmark'].slice(0, 1500)}`)
      }
      if (parts.length > 0) {
        rulesSection = `Platform listing policies to follow:\n${parts.join('\n\n')}\n\n`
      }
    }
  } catch {
    // Never block pipeline if rules fetch fails
  }

  const { data: measurementsRow } = await supabase
    .from('listings')
    .select('measurements, sub_type, gender')
    .eq('id', listingId)
    .single()

  const measurementFields = getMeasurementFields(
    step2.category,
    (measurementsRow?.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    step2.notableFeatures
  )
  const sizingSection = buildShoeSizingPromptSection({
    category: step2.category,
    brand: step2.brand,
    gender: (measurementsRow?.gender ?? null) as string | null,
    measurements: (measurementsRow?.measurements as Record<string, unknown> | null) ?? null,
  })
  // When the sizing table above already covers these, drop them from the flat measurements
  // line -- otherwise the raw "EU 39" and the formatted "EU 39 · UK 6 · US 8" both show up.
  const shoeSizingKeys = new Set(['shoe_size_system', 'shoe_size_raw', 'us_size'])
  const populatedMeasurements = measurementsRow?.measurements
    ? measurementFields.filter((field) => {
        if (sizingSection && shoeSizingKeys.has(field.key)) return false
        const value = (measurementsRow.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine = populatedMeasurements.length > 0
    ? `\n- Measurements: ${populatedMeasurements
        .map((field) => `${field.label}: ${formatMeasurementValue(field, (measurementsRow!.measurements as Record<string, unknown>)[field.key])}`)
        .join(', ')}`
    : ''

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

  // Lists every detected inclusion, not just confirmed ones -- this runs immediately after
  // gender_gate, in the automated pipeline, before the user has had any FieldsPanel
  // opportunity to confirm or reject a single detected item. Filtering on `confirmed` here
  // would always evaluate empty (ai-listings-kks final review).
  const prompt = `Generate a complete resale listing for this item.

Item details:
- Brand: ${step2.brand}
- Category: ${step2.category}
- Condition: ${step2.condition}
- Condition notes: ${step2.conditionNotes}
- Notable features: ${step2.notableFeatures.join(', ')}
- Inclusions: ${step2.inclusions
    .map((i) => i.item)
    .join(', ') || 'None noted'}${measurementsLine}${sizingSection}

Comparable sold prices:
${compsText}

${priceHint}

Use the generate_listing tool to produce the full listing.

${rulesSection}Rules:
- Canonical title: brand + model + key attributes, not platform-specific
- eBay title: exactly 80 chars or fewer, keyword-rich (buyers search "Chanel Classic Flap Medium Black Gold Hardware")
- Poshmark title: natural, 60 chars max
- eBay item specifics: brand, style/model, color, material, condition, size/dimensions where relevant
- If a Sizing line is present, present it as a compact size comparison in the description (e.g. "Sizing: EU 39 · UK 6 · US 8.5") and, if a Sizing note is present, weave it into the description as a natural sentence — never invent, alter, or omit these numbers.
- eBay category_id: use standard eBay category ID numbers (Handbags: 169291, Sneakers: 155202, Electronics/phones: 9355, Clothing tops: 53159)
- Descriptions should be factual, buyer-oriented, no filler phrases like "don't miss out"
- Do NOT end descriptions with a "Condition: X — ..." summary block — condition is displayed separately in the listing fields. Condition context may be woven naturally into the description body where relevant, but never as a labeled "Condition:" section at the end.`

  let draft: DraftOutput
  try {
    draft = await runStructured<DraftOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 3000,
      prompt,
      apiKey: apiKeys.anthropic,
      toolName: 'generate_listing',
      toolDescription: 'Generate all listing fields for a resale item',
      jsonSchema: {
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
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('step4a: Claude did not return a tool_use block')
    }
    throw err
  }

  await pushPipelineStep(listingId, {
    pipeline_step: pipelineStepFloor,
    title: draft.canonical_title,
    description: draft.canonical_description,
    // step3's comps-derived price is authoritative whenever it exists (including a
    // real low-confidence estimate) — Claude's own guess here only fills the gap
    // when step3 genuinely found nothing to work with.
    suggested_price_cents: suggestedPriceCents ?? draft.suggested_price_cents,
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
