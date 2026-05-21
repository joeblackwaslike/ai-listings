import { createClient } from '@supabase/supabase-js'

export type SettingType = 'string' | 'number' | 'decimal' | 'date' | 'json' | 'array' | 'credential'

export const PLATFORM_SETTING_KEYS = new Set([
  // Reddit / mechmarket
  'reddit_username',
  'reddit_client_id',
  'reddit_client_secret',
  'reddit_refresh_token',
  'us_state',
  // Imgur
  'imgur_client_id',
  'imgur_client_secret',
  'imgur_access_token',
  'imgur_refresh_token',
  // Poshmark
  'poshmark_cookies',
  // Mercari
  'mercari_api_token',
  // Etsy
  'etsy_client_id',
  'etsy_shop_id',
  'etsy_access_token',
  'etsy_refresh_token',
  // eBay
  'ebay_client_id',
  'ebay_client_secret',
  'ebay_refresh_token',
  // TheRealReal
  'apify_api_token',
])

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function getSetting(userId: string, key: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_key', key)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // not found
    throw new Error(`Failed to fetch setting "${key}" for user ${userId}: ${error.message}`)
  }

  return data?.setting_value ?? null
}

export async function setSetting(
  userId: string,
  key: string,
  value: string,
  type: SettingType = 'string'
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: userId, setting_key: key, setting_value: value, setting_type: type, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,setting_key' }
    )

  if (error) throw new Error(`Failed to set setting "${key}" for user ${userId}: ${error.message}`)
}

export async function getSettings(userId: string, keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('user_settings')
    .select('setting_key, setting_value')
    .eq('user_id', userId)
    .in('setting_key', keys)

  if (error) throw new Error(`Failed to fetch settings for user ${userId}: ${error.message}`)

  return Object.fromEntries(
    (data ?? [])
      .filter((r) => r.setting_value !== null)
      .map((r) => [r.setting_key, r.setting_value as string])
  )
}

export async function deleteSetting(userId: string, key: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('user_settings')
    .delete()
    .eq('user_id', userId)
    .eq('setting_key', key)

  if (error) throw new Error(`Failed to delete setting "${key}" for user ${userId}: ${error.message}`)
}
