export interface BangleSizeEntry {
  size: string
  innerDiameterMm: number
}

// Sourced 2026-08-15 from PurseForum (citing Hermès' own size guide) and
// Thrift & Tell's Hermès bracelet sizing guide during design. Validated
// against a real known Hermès Size 65 measuring 66.6mm (0.6mm gap, within
// normal tolerance) -- see ring-size.ts's sibling validation note for the
// same design session. Only Hermès is seeded; extend with other brands the
// same way (source, then validate against a real known-size item) when one
// is actually encountered -- don't design ahead of real inventory.
export const BANGLE_SIZE_LADDERS: Record<string, BangleSizeEntry[]> = {
  hermes: [
    { size: '62', innerDiameterMm: 61 },
    { size: '65', innerDiameterMm: 66 },
    { size: '70', innerDiameterMm: 70 },
  ],
}

// Brand names from vision analysis may carry their official accented
// spelling (e.g. "Hermès"), while ladder keys are stored unaccented for
// simplicity -- normalize both sides to NFD and strip combining marks so
// 'Hermès' and 'hermes' resolve to the same key.
function normalizeBrandKey(brand: string): string {
  return brand
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function snapToNearestBangleSize(brand: string, measuredMm: number): BangleSizeEntry | null {
  const ladder = BANGLE_SIZE_LADDERS[normalizeBrandKey(brand)]
  if (!ladder || ladder.length === 0) return null
  return ladder.reduce((closest, entry) =>
    Math.abs(entry.innerDiameterMm - measuredMm) < Math.abs(closest.innerDiameterMm - measuredMm) ? entry : closest
  )
}
