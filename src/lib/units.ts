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

// Fields that hold a size/identifier rather than a physical mm/inches length —
// never run through unit conversion or dual-unit formatting.
const NON_LENGTH_FIELD_KEYS = new Set(['us_size', 'shoe_size_raw', 'ring_inscribed_size'])

export function isPhysicalLengthField(key: string): boolean {
  return !NON_LENGTH_FIELD_KEYS.has(key)
}

// Renders one MeasurementField's stored value the way every display surface (FieldsPanel,
// gate-messages, description prompts) should: chip fields (e.g. rise: low/mid/high) and
// non-length fields (e.g. us_size, shoe_size_raw, ring_inscribed_size — sizes/identifiers,
// not physical dimensions) render as-is; every other numeric field gets dual-unit text.
export function formatMeasurementValue(field: MeasurementField, value: unknown): string {
  if (field.useChips || !isPhysicalLengthField(field.key)) return String(value)
  return formatDualMeasurement(Number(value))
}
