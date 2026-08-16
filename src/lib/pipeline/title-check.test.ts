import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTitleLengths, TITLE_LIMITS } from './title-check'

test('checkTitleLengths: flags an eBay title over 80 characters', () => {
  const longTitle = 'x'.repeat(TITLE_LIMITS.ebay + 1)
  const warnings = checkTitleLengths({ ebay: { title: longTitle } })
  assert.deepEqual(warnings, [{ platform: 'ebay', currentLength: longTitle.length, maxLength: TITLE_LIMITS.ebay }])
})

test('checkTitleLengths: flags a Poshmark title over 60 characters', () => {
  const longTitle = 'x'.repeat(TITLE_LIMITS.poshmark + 1)
  const warnings = checkTitleLengths({ poshmark: { title: longTitle } })
  assert.deepEqual(warnings, [{ platform: 'poshmark', currentLength: longTitle.length, maxLength: TITLE_LIMITS.poshmark }])
})

test('checkTitleLengths: returns a warning per platform when both are over limit', () => {
  const warnings = checkTitleLengths({
    ebay: { title: 'x'.repeat(TITLE_LIMITS.ebay + 1) },
    poshmark: { title: 'x'.repeat(TITLE_LIMITS.poshmark + 1) },
  })
  assert.deepEqual(warnings.map((w) => w.platform).sort(), ['ebay', 'poshmark'])
})

test('checkTitleLengths: returns no warnings when titles are within limits or missing', () => {
  assert.deepEqual(checkTitleLengths({ ebay: { title: 'short title' } }), [])
  assert.deepEqual(checkTitleLengths({}), [])
  assert.deepEqual(checkTitleLengths(null), [])
})
