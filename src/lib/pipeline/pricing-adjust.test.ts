import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionDelta, adjustForCondition, priceTierOf, CATEGORY_DISCOUNT } from './pricing-adjust'

test('conditionDelta: listing better than comp condition', () => {
  assert.equal(conditionDelta('like_new', 'Good'), 'better')
})

test('conditionDelta: listing worse than comp condition', () => {
  assert.equal(conditionDelta('fair', 'Like new'), 'worse')
})

test('conditionDelta: same rank returns same', () => {
  assert.equal(conditionDelta('good', 'Not specified'), 'same')
})

test('conditionDelta: unknown listing condition defaults to good (rank 4)', () => {
  assert.equal(conditionDelta('', 'Not specified'), 'same')
})

test('adjustForCondition: better applies +15%', () => {
  assert.equal(adjustForCondition(10000, 'better'), 11500)
})

test('adjustForCondition: worse applies -15%', () => {
  assert.equal(adjustForCondition(10000, 'worse'), 8500)
})

test('adjustForCondition: same is unchanged', () => {
  assert.equal(adjustForCondition(10000, 'same'), 10000)
})

test('CATEGORY_DISCOUNT: has an entry for every known category', () => {
  assert.equal(CATEGORY_DISCOUNT.handbag, 0.15)
  assert.equal(CATEGORY_DISCOUNT.electronics, 0.20)
})

test('priceTierOf: boundaries', () => {
  assert.equal(priceTierOf(0), 'low')
  assert.equal(priceTierOf(14_999), 'low')
  assert.equal(priceTierOf(15_000), 'mid')
  assert.equal(priceTierOf(74_999), 'mid')
  assert.equal(priceTierOf(75_000), 'high')
  assert.equal(priceTierOf(1_000_000), 'high')
})
