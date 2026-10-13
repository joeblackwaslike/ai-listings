import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragHasFiles, imageFiles, nextDisplayOrder, sameIds, splitPhotos } from './photo-column'

const photo = (id: string, type: string, display_order: number) => ({ id, type, display_order })

test('nextDisplayOrder is 0 with no photos', () => {
  assert.equal(nextDisplayOrder([]), 0)
})

test('nextDisplayOrder is the photo count for dense 0..n-1 orders', () => {
  assert.equal(nextDisplayOrder([{ display_order: 0 }, { display_order: 1 }, { display_order: 2 }]), 3)
})

test('nextDisplayOrder lands after the largest order once a drag reorder spaced them by 1000', () => {
  assert.equal(nextDisplayOrder([{ display_order: 0 }, { display_order: 1000 }, { display_order: 2000 }]), 2001)
})

test('nextDisplayOrder ignores order alone when duplicates make the count larger', () => {
  assert.equal(nextDisplayOrder([{ display_order: 0 }, { display_order: 0 }, { display_order: 0 }]), 3)
})

test('imageFiles keeps only image/* files, in order', () => {
  const f = (name: string, type: string) => new File(['x'], name, { type })
  const out = imageFiles([f('a.jpg', 'image/jpeg'), f('n.txt', 'text/plain'), f('b.png', 'image/png'), f('x', '')])
  assert.deepEqual(out.map((x) => x.name), ['a.jpg', 'b.png'])
})

test('dragHasFiles is true only when the drag carries Files', () => {
  assert.equal(dragHasFiles(['text/plain', 'Files']), true)
  assert.equal(dragHasFiles(['text/plain']), false)
  assert.equal(dragHasFiles([]), false)
  assert.equal(dragHasFiles(undefined), false)
})

test('splitPhotos sorts non-intake photos by display_order and hides intake once any exist', () => {
  const out = splitPhotos([photo('i', 'intake', 0), photo('b', 'studio', 2000), photo('a', 'studio', 5)])
  assert.deepEqual(out.gridPhotos.map((p) => p.id), ['a', 'b'])
  assert.deepEqual(out.displayPhotos.map((p) => p.id), ['a', 'b'])
  assert.equal(out.isIntakeFallback, false)
  assert.equal(out.showWideDropZone, false)
})

test('splitPhotos with only intake photos shows the intake alone and the wide drop zone', () => {
  const out = splitPhotos([photo('i', 'intake', 0)])
  assert.deepEqual(out.gridPhotos, [])
  assert.deepEqual(out.displayPhotos.map((p) => p.id), ['i'])
  assert.equal(out.isIntakeFallback, true)
  assert.equal(out.showWideDropZone, true)
})

test('splitPhotos with no photos at all still offers the wide drop zone', () => {
  const out = splitPhotos([])
  assert.deepEqual(out.displayPhotos, [])
  assert.equal(out.isIntakeFallback, false)
  assert.equal(out.showWideDropZone, true)
})

test('splitPhotos does not mutate its input', () => {
  const input = [photo('b', 'studio', 2), photo('a', 'studio', 1)]
  splitPhotos(input)
  assert.deepEqual(input.map((p) => p.id), ['b', 'a'])
})

test('sameIds is true for the same ids in any order and false once one is added or removed', () => {
  const a = [{ id: 'x' }, { id: 'y' }]
  assert.equal(sameIds(a, [{ id: 'y' }, { id: 'x' }]), true)
  assert.equal(sameIds(a, [{ id: 'x' }, { id: 'y' }, { id: 'z' }]), false)
  assert.equal(sameIds(a, [{ id: 'x' }]), false)
  assert.equal(sameIds(a, [{ id: 'x' }, { id: 'z' }]), false)
})
