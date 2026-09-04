import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import type { ClaudeImageInput } from '@/lib/claude'
import { getSupabaseAdmin } from './supabase-push'
import { toPublicUrl } from './to-public-url'
import { getUserApiKeys } from '@/lib/user-api-keys'
import type { ApiKeys } from '@/lib/user-api-keys'
import { getPlatformRules } from '@/lib/platform-rules'
import { getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import type { ClothingSubType, Inclusion, JewelrySubType, PlatformFields } from '@/types/listings'

interface RewriteOutput {
  canonical_title: string
  canonical_description: string
  ebay_title: string
  ebay_description: string
  poshmark_title: string
  poshmark_description: string
  condition_notes: string
}

/**
 * Resolves the user-scoped API keys for a listing by its ID.
 * Used by the description-rewrite Inngest function, which only receives a listingId.
 */
export async function loadApiKeys(listingId: string): Promise<ApiKeys> {
  const supabase = getSupabaseAdmin()
  const { data: listingRow, error } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', listingId)
    .single()
  if (error) throw new Error(`loadApiKeys: failed to load listing ${listingId} -- ${error.message}`)
  if (!listingRow?.user_id) throw new Error(`loadApiKeys: listing ${listingId} has no user_id`)
  return getUserApiKeys(listingRow.user_id)
}

/**
 * Rewrite all listing copy using studio photos, confirmed inclusions, measurements,
 * and condition notes. Patches title, description, and condition_notes on listings,
 * and title+description within platform_fields; all other fields (price, category,
 * item specifics, size, etc.) are preserved.
 *
 * Does NOT call pushPipelineStep — the pipeline step counter is intake-only.
 */
export async function runRewriteListing(
  listingId: string,
  apiKeys: ApiKeys,
  extraNotes: string = ''
): Promise<{ ok: true }> {
  const supabase = getSupabaseAdmin()

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select(
      'user_id, title, description, condition, condition_notes, measurements, platform_fields, inclusions, sub_type, brand, category, gender'
    )
    .eq('id', listingId)
    .single()

  if (listingError || !listing) {
    throw new Error(
      `rewrite-listing: failed to load listing ${listingId} -- ${listingError?.message ?? 'not found'}`
    )
  }

  // Studio photos for the vision call — use processed_url (background-removed) only.
  // Limit to 20 and require type=studio so intake/auth photos don't pollute the rewrite.
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('processed_url')
    .eq('listing_id', listingId)
    .eq('type', 'studio')
    .not('processed_url', 'is', null)
    .limit(20)

  if (photosError) {
    throw new Error(`rewrite-listing: failed to load studio photos for listing ${listingId} -- ${photosError.message}`)
  }

  const photoUrls = (photos ?? []).map((p) => p.processed_url as string).filter(Boolean)
  const images: ClaudeImageInput[] = await Promise.all(
    photoUrls.map(async (url) => ({ url: await toPublicUrl(url) }))
  )

  // Platform listing rules (best-effort — never block the rewrite on a rules fetch failure)
  let rulesSection = ''
  try {
    if (listing.user_id) {
      const rules = await getPlatformRules(listing.user_id as string, ['ebay', 'poshmark'])
      const parts: string[] = []
      if (rules['ebay']) parts.push(`[eBay listing rules — excerpt]\n${rules['ebay'].slice(0, 1500)}`)
      if (rules['poshmark']) parts.push(`[Poshmark listing rules — excerpt]\n${rules['poshmark'].slice(0, 1500)}`)
      if (parts.length > 0) rulesSection = `Platform listing policies to follow:\n${parts.join('\n\n')}\n\n`
    }
  } catch (rulesErr) {
    console.error(`rewrite-listing: failed to fetch platform rules for listing ${listingId} — proceeding without them:`, rulesErr)
  }

  // Measurements line — same field resolution as step4a-draft-listing.ts
  const measurementFields = getMeasurementFields(
    (listing.category ?? '') as string,
    (listing.sub_type ?? null) as ClothingSubType | JewelrySubType | null,
    [] // notableFeatures not available at rewrite time; the prompt already has photos
  )
  const populatedMeasurements = listing.measurements
    ? measurementFields.filter((field) => {
        const value = (listing.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []
  const measurementsLine =
    populatedMeasurements.length > 0
      ? `Measurements: ${populatedMeasurements
          .map(
            (field) =>
              `${field.label}: ${formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}`
          )
          .join(', ')}`
      : ''

  // Only confirmed inclusions go into the prompt
  const confirmedInclusions = ((listing.inclusions ?? []) as Inclusion[]).filter(
    (i) => i.confirmed
  )
  const inclusionsLine =
    confirmedInclusions.length > 0
      ? confirmedInclusions.map((i) => i.item + (i.notes ? ` (${i.notes})` : '')).join(', ')
      : 'None'

  const existingPf = (listing.platform_fields ?? {}) as PlatformFields

  const prompt = `You are rewriting all copy for a luxury resale listing. Studio photos are provided — use them as the primary source of truth.

Your job:
- Produce polished, accurate listing copy using only what is visible in the photos and the confirmed data below
- Reconcile description and condition_notes so there are NO contradictions between them
- Follow platform-specific character limits and style rules

Item details:
- Brand: ${listing.brand ?? 'Unknown'}
- Category: ${listing.category ?? 'Unknown'}
- Condition: ${listing.condition ?? 'Unknown'}
- Condition notes: ${listing.condition_notes ?? ''}
${extraNotes.trim() ? `- Additional user observations: ${extraNotes.trim()}` : ''}
${measurementsLine ? `- ${measurementsLine}` : ''}
- Confirmed inclusions: ${inclusionsLine}

Existing listing copy (for context — rewrite from scratch, do not just paraphrase):
Title: ${listing.title ?? ''}
Description: ${listing.description ?? ''}

Existing platform fields (for reference only — only titles and descriptions are rewritten; category, specifics, size, etc. are preserved by the system):
eBay title: ${existingPf.ebay?.title ?? ''}
eBay description: ${existingPf.ebay?.description ?? ''}
Poshmark title: ${existingPf.poshmark?.title ?? ''}
Poshmark description: ${existingPf.poshmark?.description ?? ''}

${rulesSection}Use the rewrite_listing tool to produce all updated fields.

Rules:
- canonical_title: max 80 chars, brand + model + key attributes, not platform-specific
- canonical_description: factual, buyer-oriented Markdown; include a "**Condition**" section with the condition grade and notes; no filler ("don't miss out", "rare find")
- ebay_title: max 80 chars, keyword-rich (buyers search "Chanel Classic Flap Medium Black Gold Hardware")
- ebay_description: plain text ONLY — no Markdown, no HTML, no tables, no emojis; eBay does not render them; include a "Condition:" section with grade and notes
- poshmark_title: max 50 chars, natural language
- poshmark_description: plain text; minimal emojis only if they genuinely help; include a condition section
- condition_notes: polished prose that merges AI photo observations with the condition notes above — no contradictions with the description
- Do NOT open canonical_description or poshmark_description with a key-value specification block (Style:, Collection:, Material:, Hardware:, etc.) — start with a flowing prose paragraph that describes the piece naturally
- No invented condition details — only what is in the condition and condition_notes fields above
- Inclusions/accessories: ONLY list items from the "Confirmed inclusions" line above — never add, infer, or imply accessories based on brand knowledge, product type, or typical packaging (e.g. auth cards, receipts, care booklets not in the list)`

  let rewrite: RewriteOutput
  try {
    rewrite = await runStructured<RewriteOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      images: images.length > 0 ? images : undefined,
      apiKey: apiKeys.anthropic,
      toolName: 'rewrite_listing',
      toolDescription: 'Rewrite listing copy using studio photos, confirmed condition, inclusions, and measurements',
      prompt,
      jsonSchema: {
        type: 'object' as const,
        properties: {
          canonical_title: { type: 'string', description: 'Max 80 chars, brand + model + key attributes' },
          canonical_description: { type: 'string', description: 'Markdown' },
          ebay_title: { type: 'string', description: 'Max 80 chars, keyword-optimized' },
          ebay_description: { type: 'string' },
          poshmark_title: { type: 'string', description: 'Max 50 chars' },
          poshmark_description: { type: 'string' },
          condition_notes: {
            type: 'string',
            description: 'Polished condition notes reconciled with the description — no contradictions',
          },
        },
        required: [
          'canonical_title',
          'canonical_description',
          'ebay_title',
          'ebay_description',
          'poshmark_title',
          'poshmark_description',
          'condition_notes',
        ],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('rewrite-listing: Claude did not return a tool_use block')
    }
    throw err
  }

  // Deep-merge platform_fields — preserve all existing keys, patch only title and description.
  // category_id, item_specifics, condition_id, size, original_price, ebay_listing_id, etc.
  // all survive untouched because we spread existingPf.ebay / existingPf.poshmark first.
  // platform_fields is already fetched above, so no second DB read is needed.
  const updatedPlatformFields: PlatformFields = { ...existingPf }

  if (existingPf.ebay) {
    updatedPlatformFields.ebay = {
      ...existingPf.ebay,
      title: rewrite.ebay_title,
      description: rewrite.ebay_description,
    }
  }

  if (existingPf.poshmark) {
    updatedPlatformFields.poshmark = {
      ...existingPf.poshmark,
      title: rewrite.poshmark_title,
      description: rewrite.poshmark_description,
    }
  }

  // Single update — title, description, condition_notes, and merged platform_fields together.
  // .select('id').maybeSingle() lets us detect zero-rows-affected (archived or deleted listing)
  // and throw so Inngest retries rather than silently succeeding with no DB change.
  const { data: updatedRow, error: updateError } = await supabase
    .from('listings')
    .update({
      title: rewrite.canonical_title,
      description: rewrite.canonical_description,
      condition_notes: rewrite.condition_notes,
      platform_fields: updatedPlatformFields,
    })
    .eq('id', listingId)
    .neq('status', 'archived')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(
      `rewrite-listing: failed to update listing ${listingId} -- ${updateError.message}`
    )
  }

  if (!updatedRow) {
    throw new Error(
      `rewrite-listing: update matched zero rows for listing ${listingId} -- listing may be archived or deleted`
    )
  }

  return { ok: true }
}
