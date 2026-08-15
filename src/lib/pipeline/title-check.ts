export const TITLE_LIMITS: Record<'ebay' | 'poshmark', number> = { ebay: 80, poshmark: 60 }

export interface TitleLengthWarning {
  platform: 'ebay' | 'poshmark'
  currentLength: number
  maxLength: number
}

// Warn but never block -- matches this codebase's existing convention (previously inlined
// in publish/route.ts, extracted here so the finalizing-gate checklist can reuse it without
// duplicating the limit table). Checks every platform with a stored title, not just one.
export function checkTitleLengths(
  platformFields: Partial<Record<'ebay' | 'poshmark', { title?: string }>> | null
): TitleLengthWarning[] {
  if (!platformFields) return []
  const warnings: TitleLengthWarning[] = []
  for (const platform of ['ebay', 'poshmark'] as const) {
    const title = platformFields[platform]?.title
    const maxLength = TITLE_LIMITS[platform]
    if (title && title.length > maxLength) {
      warnings.push({ platform, currentLength: title.length, maxLength })
    }
  }
  return warnings
}
