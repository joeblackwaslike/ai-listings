import type { JewelrySubType } from '@/types/listings'

export function detectJewelrySubType(notableFeatures: string[]): JewelrySubType | null {
  const model = notableFeatures.find((f) => f.startsWith('Model:'))?.slice(7).toLowerCase() ?? ''
  if (/\bring\b/.test(model)) return 'ring'
  if (/\bbangle\b/.test(model)) return 'bangle'
  if (/\bbracelet\b/.test(model)) return 'bracelet'
  if (/\bnecklace\b/.test(model)) return 'necklace'
  if (/\bearrings?\b/.test(model)) return 'earrings'
  if (/\bpendant\b/.test(model)) return 'pendant'
  if (/\bbrooch\b/.test(model)) return 'brooch'
  return null
}

// Assumes ring-typed input: callers must gate on detectJewelrySubType === 'ring' first,
// since keywords like "adjustable" are also common on non-ring jewelry.
export function detectIrregularRingStyle(notableFeatures: string[]): boolean {
  const allText = notableFeatures.join(' ').toLowerCase()
  return /\bbypass\b|\bwrap(?:ped)?\b|\bopen[\s-]?band\b|\basymmetric(?:al)?\b|\badjustable\b|\btoi[\s-]?et[\s-]?moi\b/.test(
    allText,
  )
}
