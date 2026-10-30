type PhotoMeta = Record<string, unknown> | null | undefined

/**
 * Splits a quality check into photos that still fail and photos whose stored failure should be
 * cleared. Overridden photos are left alone either way. `results[].index` points into `photoIds`.
 */
export function planQualityUpdates<R extends { index: number; passed: boolean }>(
  results: R[],
  photoIds: string[],
  storedMeta: Record<string, PhotoMeta>
): { failing: R[]; recovered: { photoId: string; meta: Record<string, unknown> }[] } {
  const failing: R[] = []
  const recovered: { photoId: string; meta: Record<string, unknown> }[] = []
  for (const r of results) {
    const photoId = photoIds[r.index]
    const meta = storedMeta[photoId]
    if (meta?.quality_overridden) continue
    if (!r.passed) failing.push(r)
    else if (meta?.quality_failed === true) recovered.push({ photoId, meta: { ...meta, quality_failed: false } })
  }
  return { failing, recovered }
}
