import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { plaintextToEbayHtml } from './ebay-description'

test('plaintextToEbayHtml escapes HTML special characters', () => {
  const result = plaintextToEbayHtml('Price < $100')
  assert.match(result, /&lt;/, 'should escape <')
  assert.doesNotMatch(result, /<\s*\$/, 'should not have unescaped <')
})

test('plaintextToEbayHtml escapes greater-than sign', () => {
  const result = plaintextToEbayHtml('Size > 5 inches')
  assert.match(result, /&gt;/, 'should escape >')
})

test('plaintextToEbayHtml escapes ampersand', () => {
  const result = plaintextToEbayHtml('Black & White')
  assert.match(result, /&amp;/, 'should escape &')
})

test('plaintextToEbayHtml escapes quotes', () => {
  const result = plaintextToEbayHtml('Size: "5 inches"')
  assert.match(result, /&quot;/, 'should escape "')
})

test('plaintextToEbayHtml preserves existing HTML tags', () => {
  const input = '<p>Already HTML</p>'
  const result = plaintextToEbayHtml(input)
  assert.equal(result, input, 'should pass through HTML unchanged')
})

test('plaintextToEbayHtml formats Key: value lines with bold', () => {
  const result = plaintextToEbayHtml('Condition: New')
  assert.match(result, /<strong>Condition:<\/strong>/, 'should bold the key')
})

test('plaintextToEbayHtml handles multiple paragraphs', () => {
  const input = 'First paragraph\n\nSecond paragraph'
  const result = plaintextToEbayHtml(input)
  assert.match(result, /<p>First paragraph<\/p>/, 'should wrap first paragraph')
  assert.match(result, /<p>Second paragraph<\/p>/, 'should wrap second paragraph')
})

test('plaintextToEbayHtml wraps output in div', () => {
  const result = plaintextToEbayHtml('Text')
  assert.match(result, /^<div>/, 'should start with div')
  assert.match(result, /<\/div>$/, 'should end with div')
})

test('plaintextToEbayHtml returns empty string unchanged', () => {
  const result = plaintextToEbayHtml('')
  assert.equal(result, '', 'should return empty string')
})
