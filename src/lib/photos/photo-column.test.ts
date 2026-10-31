import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyIdOrder, dragHasFiles, imageFiles, nextDisplayOrder, reorderUpdates, reserveStartOrder, sameIds, splitPhotos } from './photo-column'

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

test('reorderUpdates moves active to over and respaces display_order densely', () => {
  assert.deepEqual(reorderUpdates(['a', 'b', 'c'], 'a', 'c'), [
    { id: 'b', display_order: 0 },
    { id: 'c', display_order: 1 },
    { id: 'a', display_order: 2 },
  ])
  assert.deepEqual(reorderUpdates(['a', 'b', 'c'], 'c', 'a')?.map((u) => u.id), ['c', 'a', 'b'])
})

test('reorderUpdates returns null for an unknown id or a no-op move', () => {
  assert.equal(reorderUpdates(['a', 'b'], 'a', 'a'), null)
  assert.equal(reorderUpdates(['a', 'b'], 'a', 'zz'), null)
})

test('after a reorder, an upload numbered from the not-yet-refreshed props still sorts last', () => {
  for (const staleOrders of [[0, 1, 2], [0, 1000, 2000]]) {
    const stale = ['a', 'b', 'c'].map((id, i) => ({ id, display_order: staleOrders[i] }))
    const server = reorderUpdates(stale.map((p) => p.id), 'a', 'c') ?? []
    const start = nextDisplayOrder(stale)
    assert.ok(server.every((p) => p.display_order < start), `orders ${staleOrders}: start ${start}`)
  }
})

test('applyIdOrder keeps the local id order but uses the current photo objects', () => {
  const current = [{ id: 'a', url: 'a2' }, { id: 'b', url: 'b2' }]
  assert.deepEqual(applyIdOrder(current, ['b', 'a']), [{ id: 'b', url: 'b2' }, { id: 'a', url: 'a2' }])
})

test('applyIdOrder falls back to the server order when there is no local order or the set changed', () => {
  const current = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(applyIdOrder(current, null), current)
  assert.equal(applyIdOrder(current, ['b', 'a']), current)
})

test('reserveStartOrder keeps overlapping batches apart until the props catch up', () => {
  const first = reserveStartOrder(5, 0, 2)
  assert.deepEqual(first, { start: 5, reserved: 7 })
  const second = reserveStartOrder(5, first.reserved, 3)
  assert.deepEqual(second, { start: 7, reserved: 10 })
  assert.deepEqual(reserveStartOrder(12, second.reserved, 1), { start: 12, reserved: 13 })
})
