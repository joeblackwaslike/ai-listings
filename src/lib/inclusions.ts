import type { Inclusion, InclusionSource, ClothingSubType, JewelrySubType } from '@/types/listings'

export interface InclusionChecklistItem {
  item: string
  isTag?: true
  isAuthCard?: true
}

const BASE_CHECKLIST: InclusionChecklistItem[] = [
  { item: 'Original box' },
  { item: 'Dust bag/cover' },
  { item: 'Authenticity card', isAuthCard: true },
  { item: 'Receipt' },
]

export function getInclusionChecklist(
  category: string,
  subType: ClothingSubType | JewelrySubType | null
): InclusionChecklistItem[] {
  if (category === 'sneakers') {
    return [...BASE_CHECKLIST, { item: 'Extra shoelaces' }, { item: 'Brand tag', isTag: true }, { item: 'Shop bag' }]
  }
  if (category === 'watches') {
    return [...BASE_CHECKLIST, { item: 'Warranty/registration card' }, { item: 'Instruction booklet' }]
  }
  if (category === 'handbag' || category === 'small_leather_goods') {
    return [...BASE_CHECKLIST, { item: 'Shop bag' }, { item: 'Brand tag', isTag: true }, { item: 'Reseller tag/UPC' }]
  }
  return BASE_CHECKLIST
}

export function mergeDetectedInclusions(
  existing: Inclusion[],
  detected: Omit<Inclusion, 'source' | 'confirmed'>[]
): Inclusion[] {
  const seenNames = new Set(existing.map((i) => i.item.trim().toLowerCase()))
  const fresh: Inclusion[] = detected
    .filter((d) => {
      const name = d.item.trim().toLowerCase()
      if (seenNames.has(name)) return false
      seenNames.add(name)
      return true
    })
    .map((d) => ({ ...d, source: 'detected' as InclusionSource, confirmed: false }))
  return [...existing, ...fresh]
}
