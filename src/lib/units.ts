import type { MeasurementField } from '@/types/listings'

export function mmToInches(mm: number): number {
  return Math.round((mm / 25.4) * 100) / 100
}

export function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4)
}

export function formatDualMeasurement(inches: number): string {
  return `${inches} in (${inchesToMm(inches)} mm)`
}

// Fields that hold a size/identifier rather than a physical dimension — never run through
// unit conversion or dual-unit formatting. These don't follow any naming convention, so they
// have to be listed explicitly.
const NON_LENGTH_IDENTIFIER_KEYS = new Set(['us_size', 'shoe_size_raw', 'ring_inscribed_size'])

// A field is NOT a physical-length-in-inches value (and so must never be run through
// mm<->inches conversion or dual-unit formatting) if either:
//  - it's a size/identifier field with no inherent unit (the residual list above), or
//  - its key is `_mm`-suffixed, meaning it's natively millimeters (per the convention
//    documented on `Measurements` in types/listings.ts — e.g. ring/bangle inner-diameter
//    readings). Keying off the suffix instead of listing every such field by name means a
//    future `_mm` field is exempted automatically instead of requiring a synchronized edit
//    here — the exact gap that let `ring_id_mm` et al. ship without this exemption and get
//    silently corrupted by mm<->inches conversion.
export function isPhysicalLengthField(key: string): boolean {
  if (NON_LENGTH_IDENTIFIER_KEYS.has(key)) return false
  if (key.endsWith('_mm')) return false
  return true
}

// Renders one MeasurementField's stored value the way every display surface (FieldsPanel,
// gate-messages, description prompts) should: chip fields (e.g. rise: low/mid/high) and
// non-length fields (e.g. us_size, shoe_size_raw, ring_inscribed_size — sizes/identifiers,
// not physical dimensions) render as-is; every other numeric field gets dual-unit text.
export function formatMeasurementValue(field: MeasurementField, value: unknown): string {
  if (field.useChips || !isPhysicalLengthField(field.key)) return String(value)
  return formatDualMeasurement(Number(value))
}

// Only these stored keys are box dimensions. Matching by label would also catch clothing's
// `length` (collar-to-hem), which must keep its own labeled dual-unit rendering.
const DIMENSION_INITIALS: Record<string, string> = {
  width: 'L', depth: 'W', height: 'H',
  item_length_in: 'L', item_width_in: 'W', item_height_in: 'H',
}

/**
 * Compact "L × W × H" line (e.g. `9.84" L × 2.76" W × 6.69" H`) from whichever fields have
 * a box-dimension key (width/depth/height or item_length/width/height_in), in the order given; null when none have values.
 */
export function formatDimensions(m: Record<string, unknown>, fields: MeasurementField[]): string | null {
  const parts = fields.flatMap((f) => {
    const initial = DIMENSION_INITIALS[f.key]
    const value = m[f.key]
    return initial && typeof value === 'number' && Number.isFinite(value) ? [`${value}" ${initial}`] : []
  })
  return parts.length ? parts.join(' × ') : null
}

/**
 * Canonical measurements text for prompts: the L × W × H string first (when any box
 * dimensions are populated), then every other populated field as "Label: value".
 * Null when no field has a value.
 */
export function formatMeasurementsSummary(m: Record<string, unknown>, fields: MeasurementField[]): string | null {
  const populated = fields.filter((f) => m[f.key] !== undefined && m[f.key] !== null && m[f.key] !== '')
  const dims = formatDimensions(m, populated)
  const others = populated
    .filter((f) => !(f.key in DIMENSION_INITIALS))
    .map((f) => `${f.label}: ${formatMeasurementValue(f, m[f.key])}`)
  const parts = dims ? [dims, ...others] : others
  return parts.length ? parts.join(', ') : null
}
