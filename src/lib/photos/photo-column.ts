interface Ordered {
  display_order: number
}

interface Typed extends Ordered {
  type: string
}

/**
 * display_order for the first newly uploaded photo, placed after every existing one.
 * Fresh uploads are numbered 0..n-1, but a drag reorder respaces them to i * 1000, so the
 * photo count alone would slot new uploads between the first two.
 */
export function nextDisplayOrder(photos: readonly Ordered[]): number {
  return photos.reduce((next, p) => Math.max(next, p.display_order + 1), photos.length)
}

/** The image/* files from a picker or drop, in order. */
export function imageFiles(files: readonly File[]): File[] {
  return files.filter((f) => f.type.startsWith('image/'))
}

/** True when an HTML5 drag carries OS files, as opposed to text or a @dnd-kit pointer drag. */
export function dragHasFiles(types: readonly string[] | undefined): boolean {
  return types?.includes('Files') ?? false
}

/**
 * Splits a listing's photos for the photo column. Non-intake photos fill the grid in
 * display_order. With none of those, the intake photo shows alone (no thumbnails); once any
 * exists, intake is hidden entirely. The wide drop zone replaces the grid whenever it's empty.
 */
export function splitPhotos<P extends Typed>(photos: readonly P[]) {
  const gridPhotos = photos
    .filter((p) => p.type !== 'intake')
    .sort((a, b) => a.display_order - b.display_order)
  const intakePhotos = photos.filter((p) => p.type === 'intake')
  const isIntakeFallback = gridPhotos.length === 0 && intakePhotos.length > 0
  return {
    gridPhotos,
    displayPhotos: gridPhotos.length > 0 ? gridPhotos : intakePhotos,
    isIntakeFallback,
    showWideDropZone: gridPhotos.length === 0,
  }
}

/** True when both lists hold exactly the same ids, ignoring order. */
export function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  const ids = new Set(a.map((p) => p.id))
  return a.length === b.length && b.every((p) => ids.has(p.id))
}

/**
 * New display_order for every grid photo after dragging `activeId` onto `overId`, respaced
 * densely (0..n-1) so a later upload numbered from not-yet-refreshed props still sorts last.
 * Null when the move is a no-op or either id is unknown.
 */
export function reorderUpdates(
  ids: readonly string[],
  activeId: string,
  overId: string,
): { id: string; display_order: number }[] | null {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return null
  const order = ids.filter((id) => id !== activeId)
  order.splice(to, 0, activeId)
  return order.map((id, display_order) => ({ id, display_order }))
}

/**
 * The current photo objects in a locally dragged id order, so server updates (a new
 * processed_url after background removal) still show. Server order wins once the set changes.
 */
export function applyIdOrder<P extends { id: string }>(photos: readonly P[], ids: readonly string[] | null): readonly P[] {
  if (!ids || !sameIds(photos, ids.map((id) => ({ id })))) return photos
  const byId = new Map(photos.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id) as P)
}

/**
 * Start order for an upload batch. `reserved` is the first order not yet claimed by an
 * in-flight batch, so a second drop before the refresh lands doesn't reuse the same orders.
 */
export function reserveStartOrder(propsNext: number, reserved: number, count: number): { start: number; reserved: number } {
  const start = Math.max(propsNext, reserved)
  return { start, reserved: start + count }
}
