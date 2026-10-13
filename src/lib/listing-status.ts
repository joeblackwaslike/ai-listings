import type { Listing } from '@/types/listings'
import { getMeasurementFields, detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { notableFeaturesOf } from '@/lib/pipeline/gate-messages'

export type BadgeTone = 'gray' | 'amber' | 'blue' | 'emerald' | 'purple' | 'green'

export type BadgeListing = Pick<
  Listing,
  | 'status'
  | 'pipeline_step'
  | 'pipeline_total'
  | 'agent_blocked'
  | 'agent_blocked_kind'
  | 'copy_approved_at'
  | 'listing_urls'
  | 'gender'
>

export type BadgeContextInput = Pick<Listing, 'sub_type' | 'intake_meta'> & { category: string | null }

export interface BadgeContext {
  hasStudioPhotos: boolean
  needsGender: boolean
  needsMeasurements: boolean
}

export const PUBLISH_PLATFORMS = ['ebay', 'poshmark'] as const

export const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  gray: 'bg-gray-700/60 text-gray-400',
  amber: 'bg-amber-900/60 text-amber-300',
  blue: 'bg-blue-900/60 text-blue-300',
  emerald: 'bg-emerald-900/60 text-emerald-400',
  purple: 'bg-purple-900/60 text-purple-300',
  green: 'bg-green-900/60 text-green-300',
}

const GENDER_CATEGORIES = new Set(['watches', 'clothing', 'sneakers'])

export function getBadgeContext(
  listing: BadgeContextInput,
  hasStudioPhotos: boolean,
): BadgeContext {
  const category = listing.category ?? ''
  const features = notableFeaturesOf(listing.intake_meta)
  const subType =
    listing.sub_type ??
    (category === 'clothing' ? detectClothingSubType(features)
      : category === 'jewelry' ? detectJewelrySubType(features)
      : null)
  return {
    hasStudioPhotos,
    needsGender: GENDER_CATEGORIES.has(category.toLowerCase()),
    needsMeasurements: getMeasurementFields(category, subType, features).length > 0,
  }
}

export function getStatusBadge(
  listing: BadgeListing,
  ctx: BadgeContext,
): { label: string; tone: BadgeTone } {
  if (listing.agent_blocked) {
    return listing.agent_blocked_kind
      ? { label: 'Retake photos', tone: 'amber' }
      : { label: 'Needs you', tone: 'amber' }
  }
  switch (listing.status) {
    case 'intake':
      return { label: 'Processing', tone: 'gray' }
    case 'id_gate':
      return { label: 'Confirm ID', tone: 'amber' }
    case 'gender_gate':
      if (ctx.needsGender && !listing.gender) return { label: 'Pick gender', tone: 'amber' }
      if (ctx.needsMeasurements) return { label: 'Add measurements', tone: 'amber' }
      return { label: 'Needs details', tone: 'amber' }
    case 'condition_gate':
      return { label: 'Check condition', tone: 'amber' }
    case 'copy_review':
      return { label: 'Review copy', tone: 'amber' }
    case 'in_loop':
      if (listing.pipeline_step < listing.pipeline_total) return { label: 'Processing', tone: 'gray' }
      if (!ctx.hasStudioPhotos) return { label: 'Needs photos', tone: 'amber' }
      if (listing.copy_approved_at) return { label: 'Finalize', tone: 'amber' }
      return { label: 'Ready', tone: 'emerald' }
    case 'finalizing':
      return { label: 'Ready to publish', tone: 'blue' }
    case 'published': {
      const done = PUBLISH_PLATFORMS.filter((p) => listing.listing_urls?.[p]).length
      return done === PUBLISH_PLATFORMS.length
        ? { label: 'Published', tone: 'purple' }
        : { label: `Published ${done}/${PUBLISH_PLATFORMS.length}`, tone: 'emerald' }
    }
    case 'sold':
      return { label: 'Sold', tone: 'green' }
    case 'archived':
      return { label: 'Archived', tone: 'gray' }
    default: {
      const exhaustive: never = listing.status
      throw new Error(`getStatusBadge: unhandled listing status ${exhaustive as string}`)
    }
  }
}
