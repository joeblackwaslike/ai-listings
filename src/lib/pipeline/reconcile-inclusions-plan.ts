import type { Inclusion, PhotoShot } from '@/types/listings'

const PACKAGING_KEYWORDS = new Set([
  'box', 'packaging', 'dust bag', 'dustbag', 'papers', 'receipt',
  'certificate', 'pouch', 'inner box', 'outer box',
])

function isPackagingShot(shot: PhotoShot): boolean {
  const text = `${shot.shot} ${shot.description}`.toLowerCase()
  for (const kw of PACKAGING_KEYWORDS) {
    if (text.includes(kw)) return true
  }
  return false
}

/**
 * Deterministic reconcile of confirmed inclusions into the photo plan.
 *
 * - Removes shots whose inclusion_ref points to an inclusion no longer in the list.
 * - Adds a shot for each confirmed inclusion that has no matching inclusion_ref shot.
 *   New shots are inserted before packaging shots (box, dust bag, papers, etc.)
 *   and assigned order values that keep the sequence contiguous.
 *
 * Auth card shots (photo_type === 'auth_card') are left untouched — those are
 * managed by reconcilePhotoPlan in reconcile-photo-plan.ts.
 */
export function reconcileInclusionsPlan(
  inclusions: Inclusion[],
  photoPlan: PhotoShot[],
): { plan: PhotoShot[]; changed: boolean } {
  const confirmedNames = new Set(
    inclusions.filter((i) => i.confirmed).map((i) => i.item.toLowerCase()),
  )

  // Remove shots for inclusions that no longer exist
  const pruned = photoPlan.filter(
    (s) => !s.inclusion_ref || confirmedNames.has(s.inclusion_ref.toLowerCase()),
  )

  // Find inclusions that have no backing shot
  const coveredRefs = new Set(
    pruned.filter((s) => s.inclusion_ref).map((s) => s.inclusion_ref!.toLowerCase()),
  )
  const missing = inclusions.filter(
    (i) => i.confirmed && !coveredRefs.has(i.item.toLowerCase()),
  )

  if (missing.length === 0) {
    const changed = pruned.length !== photoPlan.length
    return { plan: reassignOrder(pruned), changed }
  }

  // Insert new inclusion shots before packaging shots
  const packagingStart = pruned.findIndex(isPackagingShot)
  const insertAt = packagingStart === -1 ? pruned.length : packagingStart

  const newShots: PhotoShot[] = missing.map((inc) => ({
    shot: inc.item,
    description: `Photo of included ${inc.item}${inc.notes ? ` — ${inc.notes}` : ''}.`,
    required: false,
    photo_type: 'studio' as const,
    inclusion_ref: inc.item,
  }))

  const result = [
    ...pruned.slice(0, insertAt),
    ...newShots,
    ...pruned.slice(insertAt),
  ]

  return { plan: reassignOrder(result), changed: true }
}

function reassignOrder(plan: PhotoShot[]): PhotoShot[] {
  return plan.map((shot, i) => ({ ...shot, order: i + 1 }))
}
