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
