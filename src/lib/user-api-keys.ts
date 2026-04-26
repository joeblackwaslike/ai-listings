import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export interface ApiKeys {
  anthropic: string
  serpapi: string
  photoroom: string
}

export async function getUserApiKeys(userId: string | null | undefined): Promise<ApiKeys> {
  const isDev = process.env.NODE_ENV !== 'production'

  if (!userId) {
    return {
      anthropic: isDev ? (process.env.ANTHROPIC_API_KEY ?? '') : '',
      serpapi:   isDev ? (process.env.SERPAPI_API_KEY   ?? '') : '',
      photoroom: isDev ? (process.env.PHOTOROOM_API_KEY ?? '') : '',
    }
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, api_key')
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to fetch API keys for user ${userId}: ${error.message}`)

  const keys = Object.fromEntries(
    (data ?? []).map((r) => [r.provider, r.api_key as string])
  )

  return {
    anthropic: keys.anthropic ?? (isDev ? (process.env.ANTHROPIC_API_KEY ?? '') : ''),
    serpapi:   keys.serpapi   ?? (isDev ? (process.env.SERPAPI_API_KEY   ?? '') : ''),
    photoroom: keys.photoroom ?? (isDev ? (process.env.PHOTOROOM_API_KEY ?? '') : ''),
  }
}
