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

// Renders one MeasurementField's stored value the way every display surface (FieldsPanel,
// gate-messages, description prompts) should: chip fields (e.g. rise: low/mid/high) and
// us_size (a shoe size, not a physical dimension) render as-is; every other numeric field
// gets dual-unit text.
export function formatMeasurementValue(field: MeasurementField, value: unknown): string {
  if (field.useChips || field.key === 'us_size') return String(value)
  return formatDualMeasurement(Number(value))
}
