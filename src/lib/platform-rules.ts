import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function getPlatformRules(
  userId: string,
  platforms: string[]
): Promise<Record<string, string | null>> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('platform_rules')
    .select('platform, rules_cache, cached_at')
    .eq('user_id', userId)
    .in('platform', platforms)

  const result: Record<string, string | null> = {}
  for (const platform of platforms) {
    const row = (data ?? []).find((r) => r.platform === platform)
    if (!row?.rules_cache) { result[platform] = null; continue }
    // Re-fetch if cached_at is >7 days ago (return stale cache, let background refresh)
    const ageMs = Date.now() - new Date(row.cached_at as string).getTime()
    result[platform] =
      ageMs > 7 * 24 * 60 * 60 * 1000
        ? `[Note: rules cached ${Math.floor(ageMs / 86400000)} days ago — may be outdated]\n\n${row.rules_cache}`
        : row.rules_cache
  }
  return result
}
