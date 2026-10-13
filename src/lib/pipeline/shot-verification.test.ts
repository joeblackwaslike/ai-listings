import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shotsToVerify } from './shot-verification'
import type { PhotoShot } from '@/types/listings'

function shot(name: string, overrides: Partial<PhotoShot> = {}): PhotoShot {
  return { shot: name, description: `${name} view`, required: true, photo_type: 'studio', ...overrides }
}

const plan = [shot('Front'), shot('Back'), shot('Clasp')]

test('only passing photos with an in-range shot_index produce names', () => {
  const names = shotsToVerify(plan, [
    { passed: true, shot_index: 0 },
    { passed: false, shot_index: 1 },
    { passed: true, shot_index: null },
    { passed: true, shot_index: 2 },
  ])
  assert.deepEqual(names, ['Front', 'Clasp'])
})

test('duplicate matches of one shot collapse to a single name', () => {
  const names = shotsToVerify(plan, [
    { passed: true, shot_index: 1 },
    { passed: true, shot_index: 1 },
  ])
  assert.deepEqual(names, ['Back'])
})

test('shots already verified are skipped', () => {
  const names = shotsToVerify([shot('Front', { status: 'verified' }), shot('Back', { status: 'taken' })], [
    { passed: true, shot_index: 0 },
    { passed: true, shot_index: 1 },
  ])
  assert.deepEqual(names, ['Back'])
})

test('out-of-range and non-integer indexes are ignored', () => {
  const names = shotsToVerify(plan, [
    { passed: true, shot_index: 3 },
    { passed: true, shot_index: -1 },
    { passed: true, shot_index: 0.5 },
  ])
  assert.deepEqual(names, [])
})

test('a missing shot_index (pre-upgrade memoized result) is ignored', () => {
  const names = shotsToVerify(plan, [{ passed: true } as { passed: boolean; shot_index: number | null }])
  assert.deepEqual(names, [])
})

test('an empty plan verifies nothing', () => {
  assert.deepEqual(shotsToVerify([], [{ passed: true, shot_index: 0 }]), [])
})

test('two plan entries sharing a name yield that name once', () => {
  const names = shotsToVerify([shot('Detail'), shot('Detail')], [
    { passed: true, shot_index: 0 },
    { passed: true, shot_index: 1 },
  ])
  assert.deepEqual(names, ['Detail'])
})
