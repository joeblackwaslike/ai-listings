import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRelevanceScores } from './step3-pricing-research'

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

test('parseRelevanceScores: does not stop at the first nested closing brace', () => {
  // A non-greedy or single-level regex would truncate this at the inner `}` after "black leather".
  const text = '{"0":{"score":8,"color":"black leather"},"1":{"score":9,"color":"tan canvas"}}'
  const result = parseRelevanceScores(text)
  assert.equal(result.size, 2)
  assert.deepEqual(result.get(1), { score: 9, color: 'tan canvas' })
})
