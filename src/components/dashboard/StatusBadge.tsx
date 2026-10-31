import {
  BADGE_TONE_CLASSES,
  getBadgeContext,
  getStatusBadge,
  type BadgeContextInput,
  type BadgeListing,
} from '@/lib/listing-status'

type BadgeInput = BadgeListing & BadgeContextInput

export function StatusBadge({
  listing,
  hasStudioPhotos,
}: Readonly<{ listing: BadgeInput; hasStudioPhotos: boolean }>) {
  const { label, tone } = getStatusBadge(listing, getBadgeContext(listing, hasStudioPhotos))
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full ${BADGE_TONE_CLASSES[tone]}`}>
      {label}
    </span>
  )
}
