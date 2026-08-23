import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export interface ApiKeys {
  anthropic: string
  serpapi: string
  withoutbg: string
  ebayAppId: string
  poshmarkCookies: string
  mercariToken: string
  soldcomps: string
}

// anthropic/serpapi/withoutbg/soldcomps used to be overridable per-user via the user_api_keys
// table and a Settings > API Keys panel -- removed (single-tenant app, no near-term plan to
// support other users' own keys; the panel only ever exposed 3 of these 4 providers anyway).
// They're always the deployment's own env-configured keys now, same as every other pipeline
// credential that was never per-user in the first place.
export async function getUserApiKeys(userId: string | null | undefined): Promise<ApiKeys> {
  const envKeys: ApiKeys = {
    anthropic:       process.env.ANTHROPIC_API_KEY   ?? '',
    serpapi:         process.env.SERPAPI_API_KEY      ?? '',
    withoutbg:       process.env.WITHOUTBG_API_KEY    ?? '',
    ebayAppId:       process.env.EBAY_APP_ID          ?? '',
    poshmarkCookies: process.env.POSHMARK_COOKIES     ?? '',
    mercariToken:    process.env.MERCARI_API_TOKEN     ?? '',
    soldcomps:       process.env.SOLDCOMPS_API_KEY     ?? '',
  }

  if (!userId) return envKeys

  const supabase = getSupabaseAdmin()
  const { data: settingRows } = await supabase
    .from('user_settings')
    .select('setting_key, setting_value')
    .eq('user_id', userId)
    .in('setting_key', ['ebay_client_id', 'poshmark_cookies', 'mercari_api_token'])

  const ebayAppId       = (settingRows ?? []).find((r) => r.setting_key === 'ebay_client_id')?.setting_value as string ?? ''
  const poshmarkCookies = (settingRows ?? []).find((r) => r.setting_key === 'poshmark_cookies')?.setting_value as string ?? ''
  const mercariToken    = (settingRows ?? []).find((r) => r.setting_key === 'mercari_api_token')?.setting_value as string ?? ''

  return {
    ...envKeys,
    ebayAppId:       ebayAppId       || envKeys.ebayAppId,
    poshmarkCookies: poshmarkCookies || envKeys.poshmarkCookies,
    mercariToken:    mercariToken    || envKeys.mercariToken,
  }
}
