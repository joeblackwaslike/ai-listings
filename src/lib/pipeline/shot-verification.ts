import type { PhotoShot } from '@/types/listings'

/**
 * Names of the plan shots that passing quality-check photos matched and that are not yet
 * verified, in plan order. Failed photos and unmatched or out-of-range indexes verify nothing.
 */
export function shotsToVerify(
  plan: PhotoShot[],
  results: { passed: boolean; shot_index: number | null }[]
): string[] {
  const matched = new Set(
    results
      .filter((r) => r.passed && Number.isInteger(r.shot_index))
      .map((r) => r.shot_index as number)
  )
  return [...new Set(
    plan
      .filter((s, i) => matched.has(i) && s.status !== 'verified')
      .map((s) => s.shot)
  )]
}
