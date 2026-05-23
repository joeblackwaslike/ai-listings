import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export interface ApiKeys {
  anthropic: string
  serpapi: string
  withoutbg: string
  ebayAppId: string
  poshmarkCookies: string
  mercariToken: string
}

export async function getUserApiKeys(userId: string | null | undefined): Promise<ApiKeys> {
  const isDev = process.env.NODE_ENV !== 'production'

  if (!userId) {
    return {
      anthropic:       isDev ? (process.env.ANTHROPIC_API_KEY   ?? '') : '',
      serpapi:         isDev ? (process.env.SERPAPI_API_KEY      ?? '') : '',
      withoutbg:       isDev ? (process.env.WITHOUTBG_API_KEY    ?? '') : '',
      ebayAppId:       isDev ? (process.env.EBAY_APP_ID          ?? '') : '',
      poshmarkCookies: isDev ? (process.env.POSHMARK_COOKIES     ?? '') : '',
      mercariToken:    isDev ? (process.env.MERCARI_API_TOKEN     ?? '') : '',
    }
  }

  const supabase = getSupabaseAdmin()
  const [{ data: apiKeyRows, error }, { data: settingRows }] = await Promise.all([
    supabase.from('user_api_keys').select('provider, api_key').eq('user_id', userId),
    supabase.from('user_settings').select('setting_key, setting_value').eq('user_id', userId).in('setting_key', ['ebay_client_id', 'poshmark_cookies', 'mercari_api_token']),
  ])

  if (error) throw new Error(`Failed to fetch API keys for user ${userId}: ${error.message}`)

  const keys = Object.fromEntries(
    (apiKeyRows ?? []).map((r) => [r.provider, r.api_key as string])
  )
  const ebayAppId       = (settingRows ?? []).find((r) => r.setting_key === 'ebay_client_id')?.setting_value as string ?? ''
  const poshmarkCookies = (settingRows ?? []).find((r) => r.setting_key === 'poshmark_cookies')?.setting_value as string ?? ''
  const mercariToken    = (settingRows ?? []).find((r) => r.setting_key === 'mercari_api_token')?.setting_value as string ?? ''

  return {
    anthropic:       keys.anthropic ?? (isDev ? (process.env.ANTHROPIC_API_KEY   ?? '') : ''),
    serpapi:         keys.serpapi   ?? (isDev ? (process.env.SERPAPI_API_KEY      ?? '') : ''),
    withoutbg:       keys.withoutbg ?? (isDev ? (process.env.WITHOUTBG_API_KEY    ?? '') : ''),
    ebayAppId:       ebayAppId      || (isDev ? (process.env.EBAY_APP_ID          ?? '') : ''),
    poshmarkCookies: poshmarkCookies || (isDev ? (process.env.POSHMARK_COOKIES    ?? '') : ''),
    mercariToken:    mercariToken    || (isDev ? (process.env.MERCARI_API_TOKEN    ?? '') : ''),
  }
}
