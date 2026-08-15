import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mmToInches, inchesToMm, formatDualMeasurement, formatMeasurementValue, isPhysicalLengthField } from './units'
import type { MeasurementField } from '@/types/listings'

test('mmToInches converts millimeters to inches rounded to 2 decimals', () => {
  assert.equal(mmToInches(813), 32.01)
  assert.equal(mmToInches(25.4), 1)
})

test('inchesToMm converts inches to millimeters rounded to nearest whole mm', () => {
  assert.equal(inchesToMm(32), 813)
  assert.equal(inchesToMm(1), 25)
})

test('formatDualMeasurement renders both units', () => {
  assert.equal(formatDualMeasurement(32), '32 in (813 mm)')
})

test('mm -> inches -> mm round trip stays within 1mm', () => {
  for (const mm of [10, 50, 100, 500, 813]) {
    const inches = mmToInches(mm)
    const back = inchesToMm(inches)
    assert.ok(Math.abs(back - mm) <= 1, `round trip drift too large for ${mm}mm: got ${back}mm`)
  }
})

test('formatMeasurementValue dual-formats a plain numeric field', () => {
  const field: MeasurementField = { key: 'waist', label: 'Waist', hint: 'in inches' }
  assert.equal(formatMeasurementValue(field, 32), '32 in (813 mm)')
})

test('formatMeasurementValue passes chip fields through unconverted', () => {
  const field: MeasurementField = {
    key: 'rise', label: 'Rise', hint: 'low, mid, or high', useChips: true, chipOptions: ['Low', 'Mid', 'High'],
  }
  assert.equal(formatMeasurementValue(field, 'mid'), 'mid')
})

test('formatMeasurementValue passes us_size through unconverted (not a physical dimension)', () => {
  const field: MeasurementField = { key: 'us_size', label: 'US Size', hint: 'e.g. 9.5' }
  assert.equal(formatMeasurementValue(field, 9.5), '9.5')
})

test('formatMeasurementValue passes shoe_size_raw through unconverted (a sizing-system value, not a physical length)', () => {
  const field: MeasurementField = { key: 'shoe_size_raw', label: 'Size (as printed)', hint: 'e.g. 39, 6.5, 8.5' }
  assert.equal(formatMeasurementValue(field, 8.5), '8.5')
})

test('formatMeasurementValue passes ring_inscribed_size through unconverted (a stamped size, not a physical length)', () => {
  const field: MeasurementField = {
    key: 'ring_inscribed_size', label: 'Inscribed Size', hint: 'worth checking with a magnifying glass',
  }
  assert.equal(formatMeasurementValue(field, 7.5), '7.5')
})

test('formatMeasurementValue still dual-formats real physical-length fields (regression)', () => {
  const waist: MeasurementField = { key: 'waist', label: 'Waist', hint: 'in inches' }
  assert.equal(formatMeasurementValue(waist, 32), '32 in (813 mm)')

  const ringIdMm: MeasurementField = { key: 'ring_id_mm', label: 'Inner Diameter', hint: 'mm, single reading' }
  assert.equal(formatMeasurementValue(ringIdMm, 17), '17 in (432 mm)')
})

test('isPhysicalLengthField excludes known non-length fields and includes everything else', () => {
  assert.equal(isPhysicalLengthField('us_size'), false)
  assert.equal(isPhysicalLengthField('shoe_size_raw'), false)
  assert.equal(isPhysicalLengthField('ring_inscribed_size'), false)
  assert.equal(isPhysicalLengthField('waist'), true)
  assert.equal(isPhysicalLengthField('ring_id_mm'), true)
})
