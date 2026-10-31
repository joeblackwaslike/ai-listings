import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWidth, readStoredNumber, countUnread, latestTimestamp, STORAGE_KEYS, lastSeenKey } from './workspace-layout'

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
test('readStoredNumber falls back when the default localStorage getter throws', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  try {
    assert.equal(readStoredNumber('k', 600), 600)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})
test('readStoredNumber falls back when no storage exists (SSR)', () => {
  assert.equal(readStoredNumber('k', 380), 380)
})

const T1 = '2026-10-13T12:00:00.100000+00:00'
const T2 = '2026-10-13T12:00:05.200000+00:00'
const T3 = '2026-10-13T12:01:00.000000+00:00'

test('countUnread counts messages created after lastSeenAt', () => {
  assert.equal(countUnread([T1, T2, T3], '2026-10-13T12:00:01.000Z'), 2)
})
test('countUnread does not count a message created exactly at lastSeenAt', () => {
  assert.equal(countUnread([T1, T2], T2), 0)
})
test('countUnread counts all when lastSeenAt is null', () => {
  const times = [T1, T2, T3]
  assert.equal(countUnread(times, null), times.length)
})
test('countUnread counts all when lastSeenAt is unparsable (e.g. a legacy id)', () => {
  assert.equal(countUnread([T1, T2], 'zzz'), 2)
})
test('latestTimestamp picks the later instant regardless of format', () => {
  assert.equal(latestTimestamp('2026-10-13T12:00:00.000Z', T2), T2)
  assert.equal(latestTimestamp(T3, T2), T3)
  assert.equal(latestTimestamp('2026-10-13T12:00:00.000Z', null), '2026-10-13T12:00:00.000Z')
})

test('storage keys', () => {
  assert.deepEqual(STORAGE_KEYS, { photoW: 'ws.photoW', chatW: 'ws.chatW', chatOpen: 'ws.chatOpen' })
  assert.equal(lastSeenKey('abc'), 'ws.lastSeen.abc')
})
