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
