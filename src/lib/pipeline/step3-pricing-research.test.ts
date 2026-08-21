import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRelevanceScores, extractPriceFromSnippet } from './step3-pricing-research'

test('parseRelevanceScores: parses every valid entry with its score and color', () => {
  const text = '{"0":{"score":8,"color":"black leather"},"1":{"score":3,"color":"tan canvas"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [
    [0, { score: 8, color: 'black leather' }],
    [1, { score: 3, color: 'tan canvas' }],
  ])
})

test('parseRelevanceScores: treats a missing/non-string color as null rather than throwing', () => {
  const text = '{"0":{"score":9}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual(result.get(0), { score: 9, color: null })
})

test('parseRelevanceScores: returns an empty map for malformed JSON', () => {
  const result = parseRelevanceScores('not json at all')
  assert.equal(result.size, 0)
})

test('parseRelevanceScores: returns an empty map when no JSON object is present in the text', () => {
  const result = parseRelevanceScores('Sure, here are the scores: none found.')
  assert.equal(result.size, 0)
})

test('parseRelevanceScores: skips an entry whose score is not a finite number', () => {
  const text = '{"0":{"score":"high","color":"black"},"1":{"score":7,"color":"blue"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [[1, { score: 7, color: 'blue' }]])
})

test('parseRelevanceScores: skips a non-numeric key instead of coercing it to a NaN map key', () => {
  const text = '{"foo":{"score":8,"color":"black"},"1":{"score":7,"color":"blue"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [[1, { score: 7, color: 'blue' }]])
  assert.equal([...result.keys()].some(Number.isNaN), false)
})

test('parseRelevanceScores: skips a negative index', () => {
  const text = '{"-1":{"score":8,"color":"black"},"0":{"score":7,"color":"blue"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [[0, { score: 7, color: 'blue' }]])
})

test('parseRelevanceScores: skips a score above 10 or below 0 (index/key are valid; the score value itself is out of range)', () => {
  const text = '{"0":{"score":11,"color":"black"},"1":{"score":-1,"color":"tan"},"2":{"score":10,"color":"blue"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [[2, { score: 10, color: 'blue' }]])
})

test('parseRelevanceScores: returns only the first top-level object when the LLM emits two', () => {
  const text = '{"0":{"score":8,"color":"black leather"}}{"note":"extra explanatory object"}'
  const result = parseRelevanceScores(text)
  assert.deepEqual([...result.entries()], [[0, { score: 8, color: 'black leather' }]])
})

test('parseRelevanceScores: a brace inside a quoted color value does not perturb depth counting', () => {
  const text = String.raw`{"0":{"score":8,"color":"vintage {frame} pattern"}}`
  const result = parseRelevanceScores(text)
  assert.deepEqual(result.get(0), { score: 8, color: 'vintage {frame} pattern' })
})

test('parseRelevanceScores: extracts the JSON object even with trailing prose after it', () => {
  const text = '{"0":{"score":8,"color":"black leather"}}\n\nLet me know if you need more detail.'
  const result = parseRelevanceScores(text)
  assert.deepEqual(result.get(0), { score: 8, color: 'black leather' })
})

test('parseRelevanceScores: skips over prose containing braces to find the real JSON payload', () => {
  const text = 'Note {approximate colors only}. {"0":{"score":8,"color":"black leather"}}'
  const result = parseRelevanceScores(text)
  assert.deepEqual(result.get(0), { score: 8, color: 'black leather' })
})

test('parseRelevanceScores: does not stop at the first nested closing brace', () => {
  // A non-greedy or single-level regex would truncate this at the inner `}` after "black leather".
  const text = '{"0":{"score":8,"color":"black leather"},"1":{"score":9,"color":"tan canvas"}}'
  const result = parseRelevanceScores(text)
  assert.equal(result.size, 2)
  assert.deepEqual(result.get(1), { score: 9, color: 'tan canvas' })
})

test('extractPriceFromSnippet: skips a trailing "estimated retail price" figure and picks the real price', () => {
  // HB-0102 (ai-listings dashboard report, 2026-08-21): TheRealReal snippet reported the
  // estimated retail price ($1,200) as the last dollar amount, ahead of the item's actual
  // listed price ($369) that appeared earlier in the snippet -- the old last-match heuristic
  // picked the reference price.
  const snippet = 'Now $369 · Hermes Bangle Bracelet · estimated retail price $1,200'
  assert.equal(extractPriceFromSnippet(snippet), 36900)
})

test('extractPriceFromSnippet: skips a leading "originally retail" figure and picks the real price', () => {
  const snippet = 'Originally retail $1,200 · Now $369'
  assert.equal(extractPriceFromSnippet(snippet), 36900)
})

test('extractPriceFromSnippet: skips MSRP and compare-at reference prices', () => {
  assert.equal(extractPriceFromSnippet('MSRP $1,200, our price $369'), 36900)
  assert.equal(extractPriceFromSnippet('$369 (compare at $1,200)'), 36900)
})

test('extractPriceFromSnippet: returns null when every dollar match is a reference price', () => {
  // No real price found -- returning null here is correct, not falling back to the
  // reference figure that HB-0102 showed is unreliable as an actual sale/listing price.
  const snippet = 'estimated retail price $1,200'
  assert.equal(extractPriceFromSnippet(snippet), null)
})

test('extractPriceFromSnippet: returns null when the snippet has no dollar amount', () => {
  assert.equal(extractPriceFromSnippet('Hermes Bangle Bracelet, gently used'), null)
})
