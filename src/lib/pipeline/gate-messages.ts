import type { DetailGateContext, Listing } from '@/types/listings'
import { detectClothingSubType, getMeasurementFields } from '@/lib/utils'

const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])

const GENDER_LABELS: Record<string, string> = {
  mens: "Men's",
  womens: "Women's",
  unisex: 'Unisex',
}

export type IdGateListing = Pick<Listing, 'brand' | 'category' | 'condition' | 'condition_notes' | 'intake_meta'>
export type GenderGateListing = Pick<Listing, 'category' | 'intake_meta'>

function notableFeaturesOf(intakeMeta: Record<string, unknown> | null): string[] {
  return (intakeMeta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []
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
  const clothingSubTypeHint = category === 'clothing' ? detectClothingSubType(notableFeatures) : null
  const measurementFields = getMeasurementFields(category, clothingSubTypeHint)
  const categoryNeedsMeasurements = measurementFields.length > 0

  const detailGateContext: DetailGateContext = {
    category,
    categoryNeedsGender,
    clothingSubTypeHint,
    categoryNeedsMeasurements,
    measurementFields,
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
      .map((field) => `${field.label}: ${String(measurements[field.key])}`)
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

export function shouldPersistInLoopGreeting(
  listing: Pick<Listing, 'status' | 'agent_blocked'>,
  hasHistory: boolean,
  firstMessage: string | null
): firstMessage is string {
  return !hasHistory && !!firstMessage && !listing.agent_blocked && listing.status === 'in_loop'
}
