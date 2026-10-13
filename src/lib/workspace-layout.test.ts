import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWidth, readStoredNumber, countUnread, STORAGE_KEYS, lastSeenKey } from './workspace-layout'

test('clampWidth caps at the max fraction of the total', () => {
  assert.equal(clampWidth(900, 320, 0.6, 1200), 720)
})
test('clampWidth enforces the minimum', () => {
  assert.equal(clampWidth(100, 320, 0.6, 1200), 320)
})
test('clampWidth passes through an in-range width', () => {
  assert.equal(clampWidth(600, 320, 0.6, 1200), 600)
})
test('clampWidth prefers the minimum when the max fraction is smaller than it', () => {
  assert.equal(clampWidth(500, 320, 0.6, 400), 320)
})

test('readStoredNumber falls back when getItem throws', () => {
  const storage = { getItem: () => { throw new Error('denied') } }
  assert.equal(readStoredNumber('k', 600, storage), 600)
})
test('readStoredNumber falls back on null', () => {
  assert.equal(readStoredNumber('k', 600, { getItem: () => null }), 600)
})
test('readStoredNumber falls back on a non-number', () => {
  assert.equal(readStoredNumber('k', 600, { getItem: () => 'abc' }), 600)
})
test('readStoredNumber returns a stored number', () => {
  assert.equal(readStoredNumber('k', 600, { getItem: () => '450' }), 450)
})
test('readStoredNumber falls back when no storage exists (SSR)', () => {
  assert.equal(readStoredNumber('k', 380), 380)
})

test('countUnread counts ids after lastSeen', () => {
  assert.equal(countUnread(['a', 'b', 'c'], 'a'), 2)
})
test('countUnread counts all when lastSeen is null', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(countUnread(ids, null), ids.length)
})
test('countUnread counts all when lastSeen is unknown', () => {
  assert.equal(countUnread(['a', 'b'], 'zzz'), 2)
})
test('countUnread is zero when lastSeen is the newest', () => {
  assert.equal(countUnread(['a', 'b'], 'b'), 0)
})

test('storage keys', () => {
  assert.deepEqual(STORAGE_KEYS, { photoW: 'ws.photoW', chatW: 'ws.chatW', chatOpen: 'ws.chatOpen' })
  assert.equal(lastSeenKey('abc'), 'ws.lastSeen.abc')
})
