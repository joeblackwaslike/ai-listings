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

import { inclusionPremiumCents } from './pricing-adjust'
import type { Inclusion } from '@/types/listings'

function inclusion(item: string, overrides: Partial<Inclusion> = {}): Inclusion {
  return { item, source: 'detected', confirmed: true, notes: null, ...overrides }
}

test('inclusionPremiumCents: sums confirmed matched items at the mid tier for handbag', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box'), inclusion('Dust bag/cover')],
    30_000 // mid tier
  )
  assert.equal(cents, 2000 + 1500) // handbag mid: box 2000, dust bag 1500
})

test('inclusionPremiumCents: unconfirmed items contribute nothing', () => {
  const cents = inclusionPremiumCents(
    'handbag',
    null,
    [inclusion('Original box', { confirmed: false })],
    30_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: unmatched free-text manual item contributes $0', () => {
  const cents = inclusionPremiumCents(
    'jewelry',
    null,
    [inclusion('Custom velvet pouch', { source: 'manual' })],
    10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: severed brand tag is halved vs. attached', () => {
  const attached = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'attached' })], 10_000 // low tier
  )
  const severed = inclusionPremiumCents(
    'sneakers', null, [inclusion('Brand tag', { tagState: 'severed' })], 10_000
  )
  assert.equal(attached, 500) // sneakers low: brand tag 500
  assert.equal(severed, 250)
})

test('inclusionPremiumCents: the authenticity card itself contributes $0 here (handled separately)', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Authenticity card', { docSource: 'original' })], 10_000
  )
  assert.equal(cents, 0)
})

test('inclusionPremiumCents: categories without a custom table fall back to the base item table', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('Original box')], 10_000 // low tier
  )
  assert.equal(cents, 400) // BASE_ITEM_PREMIUMS low
})

test('inclusionPremiumCents: matching is case-insensitive', () => {
  const cents = inclusionPremiumCents(
    'jewelry', null, [inclusion('original BOX')], 10_000
  )
  assert.equal(cents, 400)
})
