import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getInclusionChecklist, mergeDetectedInclusions } from './inclusions'
import type { Inclusion } from '@/types/listings'

test('getInclusionChecklist: sneakers gets base checklist plus shoelaces, brand tag, shop bag', () => {
  const checklist = getInclusionChecklist('sneakers', null)
  const items = checklist.map((c) => c.item)
  assert.deepEqual(items, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Extra shoelaces',
    'Brand tag',
    'Shop bag',
  ])
  assert.equal(checklist.find((c) => c.item === 'Brand tag')?.isTag, true)
  assert.equal(checklist.find((c) => c.item === 'Authenticity card')?.isAuthCard, true)
})

test('getInclusionChecklist: watches gets base checklist plus warranty card and instruction booklet', () => {
  const items = getInclusionChecklist('watches', null).map((c) => c.item)
  assert.deepEqual(items, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Warranty/registration card',
    'Instruction booklet',
  ])
})

test('getInclusionChecklist: handbag and small_leather_goods get shop bag, brand tag, reseller tag', () => {
  const handbagItems = getInclusionChecklist('handbag', null).map((c) => c.item)
  const slgItems = getInclusionChecklist('small_leather_goods', null).map((c) => c.item)
  assert.deepEqual(handbagItems, [
    'Original box',
    'Dust bag/cover',
    'Authenticity card',
    'Receipt',
    'Shop bag',
    'Brand tag',
    'Reseller tag/UPC',
  ])
  assert.deepEqual(slgItems, handbagItems)
})

test('getInclusionChecklist: unrecognized category falls back to the base checklist only', () => {
  const items = getInclusionChecklist('jewelry', null).map((c) => c.item)
  assert.deepEqual(items, ['Original box', 'Dust bag/cover', 'Authenticity card', 'Receipt'])
})

function detected(item: string, notes: string | null = null): Omit<Inclusion, 'source' | 'confirmed'> {
  return { item, notes }
}

test('mergeDetectedInclusions: empty existing list adds every detected item as pending detected', () => {
  const merged = mergeDetectedInclusions([], [detected('Original box'), detected('Receipt')])
  assert.equal(merged.length, 2)
  assert.ok(merged.every((i) => i.source === 'detected' && i.confirmed === false))
  assert.deepEqual(merged.map((i) => i.item), ['Original box', 'Receipt'])
})

test('mergeDetectedInclusions: skips a detected item whose name already exists (case-insensitive)', () => {
  const existing: Inclusion[] = [{ item: 'original box', source: 'manual', confirmed: true, notes: null }]
  const merged = mergeDetectedInclusions(existing, [detected('Original Box'), detected('Receipt')])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map((i) => i.item), ['original box', 'Receipt'])
  assert.equal(merged[1].source, 'detected')
})

test('mergeDetectedInclusions: with no new items, returns existing list unchanged', () => {
  const existing: Inclusion[] = [{ item: 'Receipt', source: 'manual', confirmed: true, notes: null }]
  const merged = mergeDetectedInclusions(existing, [detected('Receipt')])
  assert.deepEqual(merged, existing)
})

test('mergeDetectedInclusions: preserves tagState and docSource on newly detected items', () => {
  const merged = mergeDetectedInclusions([], [
    { item: 'Brand tag', notes: null, tagState: 'attached' },
    { item: 'Authenticity card', notes: null, docSource: 'original' },
  ])
  assert.equal(merged[0].tagState, 'attached')
  assert.equal(merged[1].docSource, 'original')
})
