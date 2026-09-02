import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import { notableFeaturesOf } from '@/lib/pipeline/gate-messages'
import { conditionDelta, adjustForCondition } from '@/lib/pipeline/pricing-adjust'
import type {
  PricingResearchResult,
  AuthChecklistResult,
  ListingDescriptionResult,
  AgentToolError,
  ClothingSubType,
  JewelrySubType,
  Inclusion,
} from '@/types/listings'

// ─── Tool: research_pricing ───────────────────────────────────────────────────

async function researchPricing(listingId: string): Promise<PricingResearchResult> {
  const supabase = getSupabaseAdmin()

  const [compsResult, listingResult] = await Promise.all([
    supabase
      .from('pricing_comps')
      .select('source, title, sale_price_cents, condition, sold_at, listing_url')
      .eq('listing_id', listingId)
      .order('sale_price_cents', { ascending: true }),
    supabase
      .from('listings')
      .select('condition')
      .eq('id', listingId)
      .single(),
  ])

  if (compsResult.error) return { ok: false, reason: `DB error: ${compsResult.error.message}` }
  const comps = compsResult.data
  if (!comps || comps.length === 0) {
    return { ok: false, reason: 'No pricing comps found. Pipeline step 3 may not have run yet.' }
  }

  const currentCondition = (listingResult.data?.condition as string | null) ?? ''

  // Recalculate condition delta and adjusted price against current listing condition,
  // not the stale step-3 values — avoids reporting wrong condition tier after manual edits.
  const recomped = comps.map((c) => {
    const delta = conditionDelta(currentCondition, (c.condition as string | null) ?? '')
    return {
      ...c,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(c.sale_price_cents as number, delta),
    }
  })

  const prices = recomped.map((c) => c.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPrice =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid]

  const confidence =
    comps.length >= 10 ? 90 :
    comps.length >= 6  ? 75 :
    comps.length >= 3  ? 60 :
    comps.length >= 1  ? 40 : 20

  const confidenceLabel = confidence >= 75 ? 'high' : confidence >= 60 ? 'medium' : 'low'

  const now = Date.now()
  const mappedComps = recomped.slice(0, 8).map((c) => ({
    source: c.source as string,
    title: c.title as string,
    price: c.sale_price_cents as number,
    condition: c.condition as string,
    conditionDelta: c.condition_delta,
    adjustedPrice: c.adjusted_price_cents,
    soldDaysAgo: c.sold_at
      ? Math.floor((now - new Date(c.sold_at as string).getTime()) / 86_400_000)
      : 0,
    url: c.listing_url as string,
  }))

  return {
    ok: true,
    suggestedPrice,
    confidence,
    confidenceSummary: `${comps.length} comp${comps.length !== 1 ? 's' : ''} · ${confidenceLabel} confidence`,
    comps: mappedComps,
    evidence: `Median of ${comps.length} sold comps (condition-adjusted to ${currentCondition || 'current condition'}). Suggested: $${(suggestedPrice / 100).toFixed(0)}.`,
  }
}

// ─── Tool: get_auth_checklist ─────────────────────────────────────────────────

async function getAuthChecklist(listingId: string): Promise<AuthChecklistResult> {
  const supabase = getSupabaseAdmin()

  const { data: listing, error } = await supabase
    .from('listings')
    .select('auth_plan, is_luxury, suggested_price_cents')
    .eq('id', listingId)
    .single()

  if (error || !listing) return { ok: false, reason: 'Listing not found' }
  if (!listing.is_luxury) return { ok: false, reason: 'No auth plan — item is not flagged as luxury' }

  const authPlan = (listing.auth_plan as Array<{
    step: string; guidance: string; status: string; photo_required: boolean
  }>) ?? []

  if (authPlan.length === 0) return { ok: false, reason: 'Auth plan not generated yet (pipeline step 5 may not have run)' }

  const steps = authPlan.map((s) => ({
    step: s.step,
    guidance: s.guidance,
    status: s.status as 'pending' | 'done' | 'failed',
    photoRequired: s.photo_required,
  }))

  const allDone = steps.every((s) => s.status === 'done')
  const anyFailed = steps.some((s) => s.status === 'failed')
  const passed = allDone && !anyFailed

  const doneRatio = steps.filter((s) => s.status === 'done').length / steps.length
  const confidence: 'high' | 'medium' | 'low' =
    doneRatio > 0.8 ? 'high' : doneRatio > 0 ? 'medium' : 'low'

  const priceCents = (listing.suggested_price_cents as number | null) ?? 0
  const AUTH_THRESHOLD = 50_000

  return {
    ok: true,
    passed,
    confidence,
    steps,
    platformAuth: {
      eligible: priceCents >= AUTH_THRESHOLD,
      platform: priceCents >= AUTH_THRESHOLD ? 'ebay' : null,
      threshold: AUTH_THRESHOLD,
      note: priceCents >= AUTH_THRESHOLD
        ? 'Item is ≥ $500 — eBay Authenticity Guarantee and Poshmark Posh Authenticate are available. Platform covers the cost; no third-party service needed.'
        : `Item is under $500 — self-authenticate using the checklist above. Platform authentication not available below $${(AUTH_THRESHOLD / 100).toFixed(0)}.`,
    },
  }
}

// ─── Tool: build_description ──────────────────────────────────────────────────

async function buildDescription(
  listingId: string,
  tone: string = 'casual'
): Promise<ListingDescriptionResult> {
  const supabase = getSupabaseAdmin()

  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('brand, category, condition, condition_notes, tags, inclusions, measurements, sub_type, suggested_price_cents, platform_fields, intake_meta')
    .eq('id', listingId)
    .single()

  if (listingErr || !listing) return { ok: false, reason: 'Listing not found' }

  const { data: comps } = await supabase
    .from('pricing_comps')
    .select('source, title, sale_price_cents, condition')
    .eq('listing_id', listingId)
    .order('sale_price_cents')
    .limit(5)

  const listingCondition = (listing.condition as string | null) ?? ''
  const compsText = comps && comps.length > 0
    ? comps.map((c) => {
        const delta = conditionDelta(listingCondition, (c.condition as string) ?? '')
        const adjusted = adjustForCondition(c.sale_price_cents as number, delta)
        return `${c.source}: "${c.title}" — $${(adjusted / 100).toFixed(0)} adjusted (${c.condition}, ${delta} condition)`
      }).join('\n')
    : 'No comps available'

  const inclusions = ((listing.inclusions as Inclusion[]) ?? [])
    .filter((i) => i.confirmed).map((i) => i.item).join(', ') || 'None noted'

  const notableFeatures = notableFeaturesOf(
    (listing.intake_meta ?? null) as Record<string, unknown> | null
  )
  const measurementFields = getMeasurementFields(
    (listing.category as string) ?? '',
    (listing.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    notableFeatures
  )
  const populatedMeasurements = listing.measurements
    ? measurementFields.filter((field) => {
        const value = (listing.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine = populatedMeasurements.length > 0
    ? `\n- Measurements: ${populatedMeasurements
        .map((field) => `${field.label}: ${formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}`)
        .join(', ')}`
    : ''

  const priceHint = listing.suggested_price_cents
    ? `Suggested price from comps: $${((listing.suggested_price_cents as number) / 100).toFixed(0)}.`
    : 'No pricing data — suggest a fair price.'

  const prompt = `Generate a resale listing for this item. Tone: ${tone}.

Item:
- Brand: ${listing.brand}
- Category: ${listing.category}
- Condition: ${listing.condition}${listing.condition_notes ? ` — ${listing.condition_notes}` : ''}
- Key features/tags: ${(listing.tags as string[] ?? []).join(', ') || 'None noted'}
- Inclusions: ${inclusions}${measurementsLine}

Comps (sold prices):
${compsText}

${priceHint}

Use the generate_listing tool. Rules:
- canonical: factual, buyer-oriented Markdown; include a "**Condition**" section with the condition grade and notes; no filler ("don't miss out", "rare find")
- eBay title: ≤ 80 chars, keyword-rich (brand + model + key attributes buyers search)
- ebay_description: plain text ONLY — no Markdown, no HTML, no tables, no emojis; eBay does not render them; include a "Condition:" section with grade and notes
- Poshmark title: ≤ 60 chars, natural language
- poshmark_description: plain text; minimal emojis only if they genuinely help readability; include a condition section
- seoKeywords: top 8 search terms buyers use for this specific item
- Condition_notes are authoritative — if they conflict with the condition grade, honour the notes and describe the item accordingly
- Do NOT add any condition observations of your own (hardware wear, scuffs, etc.) that are not stated in the condition_notes above`

  let out: {
    canonical: string; ebay_title: string; ebay_description: string
    poshmark_title: string; poshmark_description: string; seo_keywords: string[]
  }
  try {
    out = await runStructured<typeof out>({
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      prompt,
      // Not threaded through the call chain today (executeTool → buildDescription has no
      // apiKeys parameter, and threading one through would mean touching agent/chat.ts,
      // which is explicitly out of scope — see ai-listings-agh). Passing undefined here
      // preserves the pre-facade behavior exactly: the api-key backend falls back to
      // process.env.ANTHROPIC_API_KEY, same as the previous `process.env.ANTHROPIC_API_KEY!`
      // hardcode (crashes the same way today if unset).
      apiKey: undefined,
      toolName: 'generate_listing',
      toolDescription: 'Generate resale listing text',
      jsonSchema: {
        type: 'object' as const,
        properties: {
          canonical: { type: 'string', description: 'Canonical Markdown description with a "**Condition**" section; factual, no filler' },
          ebay_title: { type: 'string', description: 'eBay title, max 80 chars' },
          ebay_description: { type: 'string', description: 'Plain text only — no Markdown, no HTML, no tables, no emojis. Must include condition.' },
          poshmark_title: { type: 'string', description: 'Poshmark title, max 60 chars' },
          poshmark_description: { type: 'string', description: 'Plain text; minimal emojis only. Must include condition.' },
          seo_keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['canonical', 'ebay_title', 'ebay_description', 'poshmark_title', 'poshmark_description', 'seo_keywords'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      return { ok: false, reason: 'Claude did not return a tool_use block' }
    }
    throw err
  }

  // Return the draft for review — do NOT auto-save. The agent must show this to
  // the seller and wait for approval, then call update_listing to persist.
  return {
    ok: true,
    canonical: out.canonical,
    ebay_title: out.ebay_title,
    ebay_description: out.ebay_description,
    poshmark_title: out.poshmark_title,
    poshmark_description: out.poshmark_description,
    seoKeywords: out.seo_keywords,
  }
}

// ─── Tool: update_listing ─────────────────────────────────────────────────────

const InclusionSchema = z.object({
  item: z.string(),
  source: z.enum(['detected', 'manual']),
  confirmed: z.boolean(),
  notes: z.string().nullable(),
  tagState: z.enum(['attached', 'severed']).optional(),
  docSource: z.enum(['original', 'reseller', 'third_party']).optional(),
})

const AuthStepSchema = z.object({
  step: z.string(),
  guidance: z.string(),
  status: z.enum(['pending', 'done', 'failed']),
  photo_required: z.boolean(),
})

const PhotoShotSchema = z.object({
  shot: z.string(),
  description: z.string(),
  required: z.boolean(),
  photo_type: z.enum(['intake', 'processed', 'auth_card', 'studio']),
})

const UpdateableFieldsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  condition: z.enum(['new_with_tags', 'new_without_tags', 'like_new', 'very_good', 'good', 'fair', 'poor', 'for_parts']).optional(),
  condition_notes: z.string().optional(),
  suggested_price_cents: z.number().int().positive().optional(),
  final_price_cents: z.number().int().positive().optional(),
  inclusions: z.array(InclusionSchema).optional(),
  auth_plan: z.array(AuthStepSchema).optional(),
  photo_plan: z.array(PhotoShotSchema).optional(),
  platform_fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
}).strict()

async function updateListing(
  listingId: string,
  fields: unknown
): Promise<{ ok: true; updated: string[] } | AgentToolError> {
  const parsed = UpdateableFieldsSchema.safeParse(fields)
  if (!parsed.success) {
    return { ok: false, reason: `Invalid fields: ${parsed.error.message}` }
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return { ok: false, reason: 'No fields provided to update' }
  }

  const supabase = getSupabaseAdmin()

  // Deep-merge platform_fields with existing so we don't blow away fields like
  // ebay_listing_id / ebay_offer_id that were set at publish time.
  let finalUpdates: typeof updates = updates
  if (updates.platform_fields) {
    const { data: existing } = await supabase
      .from('listings').select('platform_fields').eq('id', listingId).single()
    const existingPf = (existing?.platform_fields ?? {}) as Record<string, unknown>
    const newPf = updates.platform_fields as Record<string, Record<string, unknown>>
    const merged: Record<string, unknown> = { ...existingPf }
    for (const [platform, fields] of Object.entries(newPf)) {
      merged[platform] = { ...(existingPf[platform] as Record<string, unknown> ?? {}), ...fields }
    }
    finalUpdates = { ...updates, platform_fields: merged }
  }

  const { error } = await supabase
    .from('listings')
    .update(finalUpdates)
    .eq('id', listingId)

  if (error) return { ok: false, reason: `DB update failed: ${error.message}` }

  return { ok: true, updated: Object.keys(updates) }
}

// ─── Tool: get_listing_summary ────────────────────────────────────────────────

async function getListingSummary(listingId: string): Promise<
  { ok: true; [key: string]: unknown } | AgentToolError
> {
  const supabase = getSupabaseAdmin()

  const [listingResult, photoCountResult, convCountResult] = await Promise.all([
    supabase.from('listings').select('*').eq('id', listingId).single(),
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('listing_id', listingId),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('listing_id', listingId),
  ])

  if (listingResult.error || !listingResult.data) {
    return { ok: false, reason: 'Listing not found' }
  }

  const l = listingResult.data as Record<string, unknown>

  return {
    ok: true,
    id: l.id,
    sku: l.sku,
    status: l.status,
    brand: l.brand,
    category: l.category,
    condition: l.condition,
    condition_notes: l.condition_notes,
    title: l.title,
    description: typeof l.description === 'string' ? l.description.slice(0, 500) : null,
    suggested_price_cents: l.suggested_price_cents,
    final_price_cents: l.final_price_cents,
    confidence_score: l.confidence_score,
    is_luxury: l.is_luxury,
    agent_blocked: l.agent_blocked,
    agent_blocked_reason: l.agent_blocked_reason,
    pipeline_step: l.pipeline_step,
    pipeline_total: l.pipeline_total,
    inclusions: l.inclusions,
    photo_plan: l.photo_plan,
    auth_plan: l.auth_plan,
    tags: l.tags,
    photo_count: photoCountResult.count ?? 0,
    conversation_count: convCountResult.count ?? 0,
  }
}

// ─── Tool: get_photo_plan ─────────────────────────────────────────────────────

async function getPhotoPlan(listingId: string): Promise<
  { ok: true; shots: unknown[]; total: number; uploaded: number; remaining: number } | AgentToolError
> {
  const supabase = getSupabaseAdmin()

  const [listingResult, photosResult] = await Promise.all([
    supabase.from('listings').select('photo_plan').eq('id', listingId).single(),
    supabase.from('photos').select('type').eq('listing_id', listingId),
  ])

  if (listingResult.error || !listingResult.data) {
    return { ok: false, reason: 'Listing not found' }
  }

  const photoPlan = (listingResult.data.photo_plan as Array<{
    shot: string; description: string; required: boolean; photo_type: string
  }>) ?? []

  const studioPhotoCount = (photosResult.data ?? []).filter((p) => p.type === 'studio').length

  const shots = photoPlan.map((s, i) => ({
    shot: s.shot,
    description: s.description,
    required: s.required,
    photo_type: s.photo_type,
    uploaded: i < studioPhotoCount,
  }))

  const uploaded = Math.min(studioPhotoCount, shots.length)

  return {
    ok: true,
    shots,
    total: shots.length,
    uploaded,
    remaining: Math.max(0, shots.length - uploaded),
  }
}

// ─── Schemas (Anthropic tool definitions) ────────────────────────────────────

export const TOOL_SCHEMAS: Anthropic.Messages.Tool[] = [
  {
    name: 'research_pricing',
    description: 'Research pricing for this listing using sold comp data. Returns suggested price, confidence score, and comparable sales. Call this when the user asks about pricing, price recommendations, or market value.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_auth_checklist',
    description: 'Get the authentication checklist for this listing. Returns checklist steps, completion status, and platform authentication eligibility. Only relevant for luxury items.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'build_description',
    description: 'Generate a draft listing description with platform-specific titles and SEO keywords. Returns the draft for seller review — does NOT save automatically. After showing the draft to the seller and getting approval, call update_listing to persist.',
    input_schema: {
      type: 'object',
      properties: {
        tone: {
          type: 'string',
          enum: ['luxury', 'casual', 'technical', 'streetwear'],
          description: 'Writing tone to match item category and buyer audience',
        },
      },
      required: [],
    },
  },
  {
    name: 'update_listing',
    description: 'Update one or more listing fields. Use this to save a description draft after the seller approves it. Pass description (canonical Markdown) and platform_fields ({ ebay: { title, description }, poshmark: { title, description } }) to persist a draft from build_description. Writeable fields: title, description, condition, condition_notes, suggested_price_cents, final_price_cents, inclusions, auth_plan, photo_plan, platform_fields, tags.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'object',
          description: 'Object with the fields to update. Only include fields that should change.',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'get_listing_summary',
    description: 'Get a full summary of this listing — all fields, photo count, and conversation count. Useful for getting a complete picture before making recommendations.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_photo_plan',
    description: 'Get the photo plan for this listing — what shots are required, what type they are, and how many have been uploaded so far.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  listingId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'research_pricing':    return researchPricing(listingId)
    case 'get_auth_checklist':  return getAuthChecklist(listingId)
    case 'build_description':   return buildDescription(listingId, input.tone as string | undefined)
    case 'update_listing':      return updateListing(listingId, input.fields)
    case 'get_listing_summary': return getListingSummary(listingId)
    case 'get_photo_plan':      return getPhotoPlan(listingId)
    default:
      return { ok: false, reason: `Unknown tool: ${name}` }
  }
}
