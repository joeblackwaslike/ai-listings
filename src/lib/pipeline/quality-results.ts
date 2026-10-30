type PhotoMeta = Record<string, unknown> | null | undefined

/**
 * Splits a quality check into photos that still fail and photos whose stored failure should be
 * cleared. Overridden photos and photos absent from `storedMeta` (deleted mid-check) are left alone either way; `liveIndexes` lists the results whose photo still exists. `results[].index` points into `photoIds`.
 */
export function planQualityUpdates<R extends { index: number; passed: boolean }>(
  results: R[],
  photoIds: string[],
  storedMeta: Record<string, PhotoMeta>
): { failing: R[]; recovered: { photoId: string; meta: Record<string, unknown> }[]; liveIndexes: number[] } {
  const failing: R[] = []
  const recovered: { photoId: string; meta: Record<string, unknown> }[] = []
  const liveIndexes: number[] = []
  for (const r of results) {
    const photoId = photoIds[r.index]
    if (!(photoId in storedMeta)) continue
    liveIndexes.push(r.index)
    const meta = storedMeta[photoId]
    if (meta?.quality_overridden) continue
    if (!r.passed) failing.push(r)
    else if (meta?.quality_failed === true) recovered.push({ photoId, meta: { ...meta, quality_failed: false } })
  }
  return { failing, recovered, liveIndexes }
}
