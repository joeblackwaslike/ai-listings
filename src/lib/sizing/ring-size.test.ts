import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ringDiameterMmToUsSize } from './ring-size'

test('ringDiameterMmToUsSize: single widest-point reading (18.3mm) overshoots the true size', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(18.3) - 8.2) < 0.1)
})

test('ringDiameterMmToUsSize: single narrowest-point reading (16.5mm) undershoots', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(16.5) - 6.0) < 0.1)
})

test('ringDiameterMmToUsSize: averaged reading (17.4mm) lands close to the true US 7.5', () => {
  assert.ok(Math.abs(ringDiameterMmToUsSize(17.4) - 7.1) < 0.1)
})

test('ringDiameterMmToUsSize: throws when diameter is below the plausible floor (~12mm)', () => {
  assert.throws(() => ringDiameterMmToUsSize(11.9), /implausible ring diameter/i)
})

test('ringDiameterMmToUsSize: throws when diameter is above the plausible ceiling (~24mm)', () => {
  assert.throws(() => ringDiameterMmToUsSize(24.1), /implausible ring diameter/i)
})

test('ringDiameterMmToUsSize: accepts a diameter just inside the floor boundary (12mm)', () => {
  assert.doesNotThrow(() => ringDiameterMmToUsSize(12))
})

test('ringDiameterMmToUsSize: accepts a diameter just inside the ceiling boundary (24mm)', () => {
  assert.doesNotThrow(() => ringDiameterMmToUsSize(24))
})

test('ringDiameterMmToUsSize: throws on NaN instead of silently returning NaN', () => {
  assert.throws(() => ringDiameterMmToUsSize(NaN), /implausible ring diameter/i)
})
