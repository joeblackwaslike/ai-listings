import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEstimatedShippingBox, SHIPPING_BOX_PADDING_IN } from './shipping-box'

test('computeEstimatedShippingBox: generic category pads each of width/height/depth by 2x the padding constant', () => {
  const box = computeEstimatedShippingBox('handbag', { width: 10, height: 8, depth: 4 })
  assert.deepEqual(box, {
    length: 4 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 10 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 8 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})

test('computeEstimatedShippingBox: generic category returns null when any of width/height/depth is missing', () => {
  assert.equal(computeEstimatedShippingBox('handbag', { width: 10, height: 8 }), null)
  assert.equal(computeEstimatedShippingBox('handbag', null), null)
})

test('computeEstimatedShippingBox: sneakers doubles item width for the pair before padding', () => {
  const box = computeEstimatedShippingBox('sneakers', {
    item_length_in: 12,
    item_width_in: 4,
    item_height_in: 5,
  })
  assert.deepEqual(box, {
    length: 12 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 4 * 2 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 5 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})

test('computeEstimatedShippingBox: sneakers returns null when any item dimension is missing', () => {
  assert.equal(computeEstimatedShippingBox('sneakers', { item_length_in: 12, item_width_in: 4 }), null)
})

test('computeEstimatedShippingBox: sneakers ignores generic width/height/depth even if present', () => {
  const box = computeEstimatedShippingBox('sneakers', {
    item_length_in: 12,
    item_width_in: 4,
    item_height_in: 5,
    width: 999,
    height: 999,
    depth: 999,
  })
  assert.deepEqual(box, {
    length: 12 + 2 * SHIPPING_BOX_PADDING_IN,
    width: 4 * 2 + 2 * SHIPPING_BOX_PADDING_IN,
    height: 5 + 2 * SHIPPING_BOX_PADDING_IN,
  })
})

test('computeEstimatedShippingBox: treats a non-numeric string dimension as missing, not as data to concatenate', () => {
  assert.equal(
    computeEstimatedShippingBox('sneakers', { item_length_in: '10' as unknown as number, item_width_in: 4, item_height_in: 5 }),
    null
  )
  assert.equal(
    computeEstimatedShippingBox('handbag', { width: '10' as unknown as number, height: 8, depth: 4 }),
    null
  )
})
