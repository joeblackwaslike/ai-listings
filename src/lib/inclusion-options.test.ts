import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inclusionOptions } from './inclusion-options'

test('empty query lists at most 4 category picks, minus present items', () => {
  const opts = inclusionOptions('', ['Dust bag/cover'], 'handbag', null)
  assert.ok(opts.length <= 4 && opts.length > 0)
  assert.ok(!opts.some((o) => o.value === 'Dust bag/cover'))
  assert.ok(!opts.some((o) => o.custom))
})

test('typed query searches every category and ends with a custom option', () => {
  const opts = inclusionOptions('re', [], 'handbag', null)
  const values = opts.map((o) => o.value)
  for (const v of ['Receipt', 'Reseller tag/UPC', 'Warranty/registration card']) {
    assert.ok(values.includes(v), `missing ${v}`)
  }
  assert.deepEqual(opts.at(-1), { value: 're', custom: true })
  assert.ok(opts.filter((o) => !o.custom).length <= 8)
})

test('exact match (any case) gets no custom option', () => {
  const opts = inclusionOptions('receipt', [], 'other', null)
  assert.ok(!opts.some((o) => o.custom))
  assert.deepEqual(opts.map((o) => o.value), ['Receipt'])
})

test('present matching is case-insensitive', () => {
  const opts = inclusionOptions('box', ['ORIGINAL BOX'], 'handbag', null)
  assert.ok(!opts.some((o) => o.value === 'Original box'))
  const empty = inclusionOptions('', ['original box', 'dust bag/cover'], 'other', null)
  assert.deepEqual(empty.map((o) => o.value), ['Authenticity card', 'Receipt'])
})

test('whitespace-only query behaves like an empty query', () => {
  const opts = inclusionOptions('   ', [], 'other', null)
  assert.ok(opts.length <= 4 && !opts.some((o) => o.custom))
})
