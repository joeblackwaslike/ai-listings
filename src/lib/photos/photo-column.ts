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
