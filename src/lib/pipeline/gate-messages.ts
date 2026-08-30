import type { DetailGateContext, Listing } from '@/types/listings'
import { detectClothingSubType, getMeasurementFields } from '@/lib/utils'
import { detectJewelrySubType, parseChainLengthInches } from '@/lib/jewelry-detection'
import { formatMeasurementValue } from '@/lib/units'

const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])

const GENDER_LABELS: Record<string, string> = {
  mens: "Men's",
  womens: "Women's",
  unisex: 'Unisex',
}

export type IdGateListing = Pick<Listing, 'brand' | 'category' | 'condition' | 'condition_notes' | 'intake_meta'>
export type GenderGateListing = Pick<Listing, 'category' | 'intake_meta'>

export function notableFeaturesOf(intakeMeta: Record<string, unknown> | null): string[] {
  const source = intakeMeta?.visionAnalysis ?? intakeMeta?.textAnalysis
  return (source as { notable_features?: string[] } | undefined)?.notable_features ?? []
}

export function buildIdGatePrompt(listing: IdGateListing): string {
  const brand = listing.brand ?? 'Unknown brand'
  const category = listing.category ?? 'unknown category'
  const condition = (listing.condition ?? 'unknown condition').replace(/_/g, ' ')
  const notes = listing.condition_notes
  const features = notableFeaturesOf(listing.intake_meta)

  return [
    "I've analyzed the photo. Here's what I found:",
    '',
    `Brand: ${brand}`,
    `Category: ${category}`,
    ...(features.length > 0 ? ['', ...features.map((f) => `• ${f}`)] : []),
    '',
    `Condition: ${condition}`,
    notes ? `Notes: ${notes}` : null,
    '',
    "Does this look right? Confirm to continue to pricing research, or describe what's wrong.",
  ].filter((l): l is string => l !== null).join('\n')
}

export function buildIdGateSnapshot(listing: IdGateListing): Record<string, unknown> {
  return {
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    condition_notes: listing.condition_notes,
    notable_features: notableFeaturesOf(listing.intake_meta),
  }
}

export function buildGenderGatePrompt(
  listing: GenderGateListing
): { message: string; detailGateContext: DetailGateContext } {
  const category = listing.category ?? 'item'
  const categoryNeedsGender = GENDER_CATEGORIES.has(category.toLowerCase())
  const notableFeatures = notableFeaturesOf(listing.intake_meta)
  let subTypeHint: DetailGateContext['subTypeHint'] = null
  if (category === 'clothing') {
    subTypeHint = detectClothingSubType(notableFeatures)
  } else if (category === 'jewelry') {
    subTypeHint = detectJewelrySubType(notableFeatures)
  }
  const measurementFields = getMeasurementFields(category, subTypeHint, notableFeatures)
  const categoryNeedsMeasurements = measurementFields.length > 0

  let defaultMeasurementValues: DetailGateContext['defaultMeasurementValues']
  if (subTypeHint === 'necklace') {
    const chainLengthInches = parseChainLengthInches(notableFeatures)
    if (chainLengthInches !== null) {
      defaultMeasurementValues = { necklace_chain_length_in: chainLengthInches }
    }
  }

  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    subTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
    defaultMeasurementValues,
  }

  if (!categoryNeedsGender) {
    const message = categoryNeedsMeasurements
      ? `Quick question before I run pricing — I need a few measurements for this ${category} to find accurate comps.`
      : `Getting ready to run pricing research for this ${category}.`
    return { message, detailGateContext }
  }

  const message = categoryNeedsMeasurements
    ? `Quick question before I run pricing — what's the gender and size for this ${category}? Pick the gender below, then I'll ask for measurements.`
    : `Quick question before I run pricing — is this ${category} Men's or Women's?`

  return { message, detailGateContext }
}

export function synthesizeIdGateAnswer(args: {
  confirmed: boolean
  corrections: string | null
  listing: IdGateListing
}): string {
  if (!args.confirmed) return args.corrections ?? ''

  const brand = args.listing.brand ?? 'Unknown brand'
  const category = args.listing.category ?? 'unknown category'
  const condition = (args.listing.condition ?? 'unknown condition').replace(/_/g, ' ')
  return `Confirmed — ${brand} ${category}, condition: ${condition}.`
}

export function synthesizeGenderGateAnswer(args: {
  gender: string | null
  measurements: Record<string, unknown> | null
  detailGateContext: DetailGateContext
}): string {
  const parts: string[] = []

  if (args.gender) {
    parts.push(GENDER_LABELS[args.gender] ?? args.gender)
  }

  if (args.measurements) {
    const measurements = args.measurements
    const lines = args.detailGateContext.measurementFields
      .filter((field) => measurements[field.key] !== undefined && measurements[field.key] !== null && measurements[field.key] !== '')
      .map((field) => `${field.label}: ${formatMeasurementValue(field, measurements[field.key])}`)
    if (lines.length > 0) parts.push(lines.join(', '))
  }

  return parts.join(' — ')
}

export function buildIdGateAck(args: { confirmed: boolean }): string {
  return args.confirmed
    ? 'Confirmed! Running pricing research now — the listing will update in a moment.'
    : 'Got it — re-running the identification with your correction. The card will update shortly.'
}

export function buildGenderGateAck(): string {
  return 'Got it — running pricing research now. The listing will update in a moment.'
}

// listings.status stays 'gender_gate' for the rest of the intake pipeline (pricing research,
// draft listing, background removal) after the gate is answered -- it only advances once all
// of that finishes, which can take a while. A page reload/remount during that window would
// otherwise re-derive "gate still pending" from status alone and re-show the gender/measurement
// form even though it was already submitted (ai-listings-ftg). confirm-gender's
// route always ends its conversation insert with buildGenderGateAck() as the last row, so its
// presence at the tail of history is a reliable, DB-persisted "already answered" signal.
export function isGenderGateAnswered(history: { role: string; content: string }[]): boolean {
  const last = history[history.length - 1]
  return last?.role === 'assistant' && last.content === buildGenderGateAck()
}

// Cheap pre-filter for whether page.tsx should even attempt to persist the live-recomputed
// greeting/gate/blocked-reason message -- the authoritative "does this already match the last
// stored message" check lives in the insert_conversation_if_new DB function (migration 0022),
// not here, because that decision has to run atomically against the true current state at
// insert time. Deciding it here against a `history` array fetched moments earlier in the
// request raced under concurrent page loads (AutoRefresh polling, multiple tabs): two
// overlapping requests could both see "differs from last" and both insert, producing a
// duplicate id-gate/gender-gate prompt seconds apart -- confirmed live on HB-0102 and SN-0035
// (ai-listings dashboard report, 2026-08-21). buildWorkspaceContext (page.tsx) only ever
// recomputes firstMessage fresh for these four cases, so this only needs to gate on "is this
// one of them" -- it does NOT need its own hasHistory/id_gate change-detection anymore.
// Suffix that all agent_blocked "photos need attention" messages share regardless of count.
// Used to deduplicate across multiple confirm cycles instead of exact-content matching.
const BLOCKED_SUFFIX = 'need attention — see the checklist below.'

export function shouldAttemptPersistGreeting(
  listing: Pick<Listing, 'status' | 'agent_blocked'>,
  firstMessage: string | null,
  history: { role: string; content: string }[]
): firstMessage is string {
  if (!firstMessage) return false
  if (listing.agent_blocked) {
    // Only insert a blocked message if no prior one with the same suffix already exists.
    // The count changes each cycle ("1 photo" → "12 photos") so exact dedup misses these.
    return !history.some((m) => m.role === 'assistant' && m.content.endsWith(BLOCKED_SUFFIX))
  }
  // in_loop messages are transient UI hints — they change as the listing progresses and
  // should not be persisted (leads to stale "upload photos" messages appearing after upload).
  return listing.status === 'id_gate' || listing.status === 'gender_gate' || listing.status === 'condition_gate'
}
