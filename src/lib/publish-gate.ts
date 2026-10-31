import { isPricingGateUnlocked } from '@/lib/pipeline/pricing-adjust'
import type { Listing, ListingStatus, Photo } from '@/types/listings'

export type GateResult = { ok: true } | { ok: false; reason: string }

const PUBLISHABLE_STATUSES: ReadonlyArray<ListingStatus> = ['in_loop', 'finalizing']

export function canConfirmCondition(l: Pick<Listing, 'photos_confirmed'>): GateResult {
  return l.photos_confirmed
    ? { ok: true }
    : { ok: false, reason: 'Confirm studio photos before confirming condition.' }
}

export function canFinalizeOrPublish(
  l: Pick<Listing, 'photos_confirmed' | 'condition_confirmed' | 'inclusions' | 'copy_approved_at' | 'status'>,
  photos: Pick<Photo, 'type' | 'photoroom_meta'>[]
): GateResult {
  const shipped = l.status === 'published' || l.status === 'sold'
  if (!shipped && !l.photos_confirmed) return { ok: false, reason: 'Confirm studio photos first.' }
  if (!shipped && !photos.some((p) => p.type === 'studio')) return { ok: false, reason: 'Add at least one studio photo first.' }
  if (!isPricingGateUnlocked({ condition_confirmed: l.condition_confirmed, inclusions: l.inclusions ?? [] })) {
    return { ok: false, reason: 'Confirm condition and all inclusions first.' }
  }
  if (shipped) return { ok: true }
  if (!l.copy_approved_at) return { ok: false, reason: 'Approve the listing copy first.' }
  if (photos.some((p) => p.type === 'studio' && p.photoroom_meta?.quality_failed === true)) {
    return { ok: false, reason: 'Resolve failed studio photo quality checks first.' }
  }
  if (!PUBLISHABLE_STATUSES.includes(l.status)) {
    return { ok: false, reason: `Listing status "${l.status}" is not ready to publish.` }
  }
  return { ok: true }
}
