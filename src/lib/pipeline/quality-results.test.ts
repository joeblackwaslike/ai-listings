import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planQualityUpdates } from './quality-results'

const result = (index: number, passed: boolean) => ({ index, passed, issues: passed ? [] : ['blurry'], verdict: passed ? 'ok' : 'bad' })
const ids = ['a', 'b']

test('fail then pass: a stored failure is cleared and other meta is kept', () => {
  const plan = planQualityUpdates([result(0, true), result(1, true)], ids, {
    a: { quality_failed: true, quality_issues: ['blurry'], bg_removed: true },
    b: null,
  })
  assert.deepEqual(plan.failing, [])
  assert.deepEqual(plan.recovered, [{ photoId: 'a', meta: { quality_failed: false, quality_issues: ['blurry'], bg_removed: true } }])
})

test('still failing photos are reported and not recovered', () => {
  const plan = planQualityUpdates([result(0, false), result(1, true)], ids, { a: { quality_failed: true }, b: null })
  assert.deepEqual(plan.failing.map((r) => r.index), [0])
  assert.deepEqual(plan.recovered, [])
})

test('overridden photos are neither failing nor recovered', () => {
  const plan = planQualityUpdates([result(0, false), result(1, true)], ids, {
    a: { quality_overridden: true, quality_failed: true },
    b: { quality_overridden: true, quality_failed: true },
  })
  assert.deepEqual(plan.failing, [])
  assert.deepEqual(plan.recovered, [])
})

test('passing photos with nothing stored need no update', () => {
  const plan = planQualityUpdates([result(0, true), result(1, true)], ids, { a: null, b: { quality_failed: false } })
  assert.deepEqual(plan, { failing: [], recovered: [] })
})

test('photos deleted while the check ran are ignored, but an existing photo with null meta is not', () => {
  const plan = planQualityUpdates([result(0, false), result(1, false)], ids, { b: null })
  assert.deepEqual(plan.failing.map((r) => r.index), [1])
  assert.deepEqual(plan.recovered, [])
})
