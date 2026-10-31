import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inclusionOptions, defaultHighlight, enterValue } from './inclusion-options'

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

const opts = [{ value: 'Box' }, { value: 'Dust bag' }]

test('no option is highlighted until the user types or arrows down', () => {
  assert.equal(defaultHighlight(''), -1)
  assert.equal(defaultHighlight('   '), -1)
  assert.equal(defaultHighlight('du'), 0)
})

test('bare Enter with nothing typed and nothing highlighted adds nothing', () => {
  assert.equal(enterValue(opts, -1, true, ''), null)
  assert.equal(enterValue(opts, -1, false, '  '), null)
})

test('Enter adds the highlighted option while the list is open', () => {
  assert.equal(enterValue(opts, 1, true, ''), 'Dust bag')
  assert.equal(enterValue(opts, 0, true, 'du'), 'Box')
})

test('Enter adds the typed text when nothing is highlighted or the list was closed', () => {
  assert.equal(enterValue(opts, -1, true, ' Strap '), 'Strap')
  assert.equal(enterValue(opts, 0, false, 'Strap'), 'Strap')
})
