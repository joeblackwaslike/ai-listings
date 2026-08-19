import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapToNearestBangleSize } from './bangle-ladders'

test('snapToNearestBangleSize snaps a real Hermès Size 65 measurement (66.6mm) to 65', () => {
  const result = snapToNearestBangleSize('hermes', 66.6)
  assert.equal(result?.size, '65')
})

test('snapToNearestBangleSize returns null for an unseeded brand', () => {
  assert.equal(snapToNearestBangleSize('unknown-brand', 66.6), null)
})

test('snapToNearestBangleSize picks the nearest of three sizes', () => {
  assert.equal(snapToNearestBangleSize('hermes', 61.5)?.size, '62')
  assert.equal(snapToNearestBangleSize('hermes', 70.0)?.size, '70')
})

test('snapToNearestBangleSize matches the accented brand name "Hermès" (as vision analysis would emit)', () => {
  assert.equal(snapToNearestBangleSize('Hermès', 66.6)?.size, '65')
})
