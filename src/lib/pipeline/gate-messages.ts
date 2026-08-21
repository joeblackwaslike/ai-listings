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

// The in_loop "analysis is done, upload studio photos" greeting only persists once (the
// AgentChat client only shows the live firstMessage prop when messages.length === 0, so a
// stale first message otherwise sits at the top of history forever). id_gate/gender_gate
// prompts are recomputed live on every render instead (buildWorkspaceContext calls
// idGateContext/genderGateContext unconditionally for those statuses) but were never
// persisted at all, so once *any* row existed in history -- including a stale in_loop
// greeting from before the pipeline reached the gate -- the fresh gate prompt (item
// description included) never appeared: buttons update live from `suggestions`, but the
// visible text stayed frozen on whatever was last written to `conversations` (ai-listings
// dashboard report, HB-0100: "Yes/Something's wrong" buttons shown under a stale "upload
// studio photos" message with no item description). Persisting a new row whenever the fresh
// gate prompt differs from the last stored message keeps history append-only (matches
// isGenderGateAnswered's reliance on the tail of history above) while self-healing this once
// the listing's next natural gate transition or re-identify attempt runs.
export function shouldPersistInLoopGreeting(
  listing: Pick<Listing, 'status' | 'agent_blocked'>,
  history: { role: string; content: string }[],
  firstMessage: string | null
): firstMessage is string {
  if (!firstMessage || listing.agent_blocked) return false
  if (listing.status === 'in_loop') return history.length === 0
  if (listing.status === 'id_gate' || listing.status === 'gender_gate') {
    return history[history.length - 1]?.content !== firstMessage
  }
  return false
}
