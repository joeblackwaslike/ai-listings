export interface ShoeConversionEntry {
  eu: number
  us: number
}

export interface ShoeBrandOverride {
  conversions: Record<'mens' | 'womens', ShoeConversionEntry[]>
  note?: string
}

// SOURCE: https://whatismysize.com/tools/eu-to-us-shoe-size (fetched 2026-08-15) is the primary
// source for the discrete values below. A separate web-search synthesis blending
// coolconversion.com, size.ly, whatismysize.com, yawteef.com, grivetoutdoors.com, and
// healthyfeetstore.com matched these numbers exactly at EU 36/38/39/40/41 for both men's and
// women's. However, fetching size.ly's own page directly shows real disagreement at several of
// those same points -- EU38 (men 5 vs. 5.5, women 7.5 vs. 7 here), EU39 (men 6 vs. 6.5, women
// 8.5 vs. 8 here), and EU36 women (6 vs. 5.5 here) are each off by half a US size from the
// whatismysize.com values used below; only EU41 matches exactly between the two. This is
// consistent with the well-known fact that EU/US shoe conversions vary by chart and by
// brand/last -- whatismysize.com was picked as a single internally-consistent primary source
// rather than averaging across disagreeing charts, but a result within half a US size of the
// table below should be treated as normal cross-chart noise, not a defect in this data.
// EU sizing is unisex (Paris point system); US sizing splits into
// separate men's/women's scales offset by ~1.5 sizes at the same EU value, which is why two
// tables are needed rather than one generic + a gender shift. Only the discrete EU values the
// source actually publishes are included -- interpolating the gaps (e.g. EU 37 for men's) would
// invent precision the source doesn't provide.
export const SHOE_SIZE_CONVERSION: Record<'mens' | 'womens', ShoeConversionEntry[]> = {
  mens: [
    { eu: 36, us: 4 },
    { eu: 36.5, us: 4.5 },
    { eu: 37.5, us: 5 },
    { eu: 38, us: 5.5 },
    { eu: 38.5, us: 6 },
    { eu: 39, us: 6.5 },
    { eu: 40, us: 7 },
    { eu: 40.5, us: 7.5 },
    { eu: 41, us: 8 },
    { eu: 42, us: 8.5 },
    { eu: 42.5, us: 9 },
    { eu: 43, us: 9.5 },
    { eu: 44, us: 10 },
    { eu: 44.5, us: 10.5 },
    { eu: 45, us: 11 },
    { eu: 45.5, us: 11.5 },
    { eu: 46, us: 12 },
  ],
  womens: [
    { eu: 36, us: 5.5 },
    { eu: 36.5, us: 6 },
    { eu: 37.5, us: 6.5 },
    { eu: 38, us: 7 },
    { eu: 38.5, us: 7.5 },
    { eu: 39, us: 8 },
    { eu: 40, us: 8.5 },
    { eu: 40.5, us: 9 },
    { eu: 41, us: 9.5 },
    { eu: 42, us: 10 },
    { eu: 42.5, us: 10.5 },
    { eu: 43, us: 11 },
    { eu: 44, us: 11.5 },
    { eu: 44.5, us: 12 },
    { eu: 45, us: 12.5 },
    { eu: 45.5, us: 13 },
    { eu: 46, us: 13.5 },
  ],
}

// SOURCE: web search "Chanel Gucci Louis Vuitton Louboutin shoe sizing runs small note"
// (2026-08-15) -- no sourced brand quirks found. Every hit was qualitative, style-dependent,
// and often internally contradictory rather than a clean numeric override:
//   - Chanel: espadrilles reportedly run small (buy 0.5-1 size up) but slingbacks reportedly
//     run true to size -- a per-style claim, not a brand-wide EU/US offset.
//   - Gucci: sneakers "may" run small per an anecdotal 1stdibs Q&A, not a brand-published guide.
//   - Louis Vuitton: sources disagree -- some say true to size for sneakers/flats, others say
//     small for pumps/heels due to "Italian sizing" (LV is French, not Italian, which further
//     undercuts that claim's reliability).
//   - Christian Louboutin: the brand's own FAQ (https://us.christianlouboutin.com/us_en/faq/fit-and-sizing/)
//     states the line runs true to size -- i.e. explicitly no override needed.
// Per the task's instruction to omit rather than guess, this table is intentionally empty.
// Seed a brand here only when a specific, sourced, brand-published numeric conversion is found.
export const SHOE_BRAND_OVERRIDES: Record<string, ShoeBrandOverride> = {}

// Mirrors snapToNearestBangleSize's empty-ladder guard in ./bangle-ladders.ts: an empty table
// (e.g. a future brand override seeded for only one gender, `conversions: { mens: [], womens:
// [] }`) returns null instead of letting `.reduce` throw an uncaught TypeError on an empty
// array. Callers fall through to the generic table on null, matching "no override" semantics.
function nearestUsSize(table: ShoeConversionEntry[], eu: number): number | null {
  if (table.length === 0) return null
  // Array.reduce keeps the first (leftmost, i.e. smaller/earlier-listed) entry on an exact tie,
  // because the comparison is strict (`<`) -- a `eu` value exactly equidistant between two table
  // entries resolves to whichever one appears earlier in the array, not necessarily the smaller
  // EU value, so tables should be listed in ascending EU order (as they are above) for that to
  // also mean "rounds down" on a tie.
  const closest = table.reduce((a, b) => (Math.abs(b.eu - eu) < Math.abs(a.eu - eu) ? b : a))
  return closest.us
}

// Reverse of nearestUsSize -- same nearest-match/empty-table-guard shape, just comparing the
// `.us` field instead of `.eu`. Needed so a raw US-system input (which today's field hint
// explicitly allows: "skip if only EU/UK is shown") can still produce an EU/UK display row.
// Tie-breaks to the earlier (lower-US-value) entry on an exact match, same as nearestUsSize.
function nearestEuForUs(table: ShoeConversionEntry[], us: number): number | null {
  if (table.length === 0) return null
  const closest = table.reduce((a, b) => (Math.abs(b.us - us) < Math.abs(a.us - us) ? b : a))
  return closest.eu
}

// UK footwear sizes have no direct entry in the sourced table above. Per the task's fallback
// instruction, UK is converted to its EU equivalent using the standard UK+33 offset
// (EU ~= UK + 33) before doing the EU lookup. This is a widely used approximation for adult
// sizing, not a brand-verified figure -- if a brand publishes real UK numbers, use those
// directly instead of this offset.
function ukToEu(uk: number): number {
  return uk + 33
}

// Brand names from vision analysis may carry accented spelling (e.g. a French or Italian house
// name), while override keys are stored unaccented for simplicity -- normalize both sides to
// NFD and strip combining marks, matching normalizeBrandKey in ./bangle-ladders.ts.
function normalizeBrandKey(brand: string): string {
  return brand
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function convertShoeSize(args: {
  brand: string
  system: 'us' | 'eu' | 'uk'
  value: number
  gender: 'mens' | 'womens'
}): { usSize: number; euSize: number; ukSize: number; source: 'brand' | 'generic'; note?: string } {
  if (args.system === 'us') {
    const euValue = nearestEuForUs(SHOE_SIZE_CONVERSION[args.gender], args.value)
    if (euValue === null) {
      throw new Error(`No generic shoe size conversion table entries for gender "${args.gender}"`)
    }
    return { usSize: args.value, euSize: euValue, ukSize: euValue - 33, source: 'generic' }
  }
  const euValue = args.system === 'uk' ? ukToEu(args.value) : args.value
  const override = SHOE_BRAND_OVERRIDES[normalizeBrandKey(args.brand)]
  const brandUsSize = override ? nearestUsSize(override.conversions[args.gender], euValue) : null
  if (brandUsSize !== null) {
    return { usSize: brandUsSize, euSize: euValue, ukSize: euValue - 33, source: 'brand', note: override?.note }
  }
  const genericUsSize = nearestUsSize(SHOE_SIZE_CONVERSION[args.gender], euValue)
  if (genericUsSize === null) {
    throw new Error(`No generic shoe size conversion table entries for gender "${args.gender}"`)
  }
  return { usSize: genericUsSize, euSize: euValue, ukSize: euValue - 33, source: 'generic' }
}

// Backfills `us_size` at gate-confirmation write time when the shopper only entered an EU/UK
// size -- the measurement field's own hint promises this ("skip if only EU/UK is shown -- this
// gets computed otherwise") but nothing called convertShoeSize to actually do it. Returns null
// (no-op) rather than a copy of the input when there's nothing to compute, so callers can do
// `if (result) measurements = result` without a redundant no-op assignment.
export function deriveShoeUsSizeForStorage(args: {
  category: string
  gender: string | null
  brand: string
  measurements: Record<string, unknown> | null
}): Record<string, unknown> | null {
  if (args.category !== 'sneakers' || !args.measurements) return null
  const m = args.measurements
  if (typeof m.us_size === 'number' && !Number.isNaN(m.us_size)) return null
  const rawSystem = typeof m.shoe_size_system === 'string' ? m.shoe_size_system.toLowerCase() : null
  if (rawSystem !== 'us' && rawSystem !== 'eu' && rawSystem !== 'uk') return null
  const rawValue = typeof m.shoe_size_raw === 'string' ? Number.parseFloat(m.shoe_size_raw) : null
  if (rawValue === null || Number.isNaN(rawValue)) return null
  if (args.gender !== 'mens' && args.gender !== 'womens') return null
  const converted = convertShoeSize({ brand: args.brand, system: rawSystem as 'us' | 'eu' | 'uk', value: rawValue, gender: args.gender })
  return { ...m, us_size: converted.usSize }
}
