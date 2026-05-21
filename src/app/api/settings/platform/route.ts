import { createClient } from '@/lib/supabase/server'
import { setSetting } from '@/lib/user-settings'

const VALID_KEYS = new Set([
  'reddit_username',
  'us_state',
  'imgur_access_token',
  'reddit_refresh_token',
  'poshmark_cookies',
  'mercari_api_token',
  'etsy_access_token',
  'ebay_refresh_token',
  'apify_api_token',
])

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: unknown; value?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { key, value } = body

  if (typeof key !== 'string' || !VALID_KEYS.has(key)) {
    return Response.json({ error: `key must be one of: ${[...VALID_KEYS].join(', ')}` }, { status: 400 })
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return Response.json({ error: 'value must be a non-empty string' }, { status: 400 })
  }

  try {
    await setSetting(user.id, key, value.trim(), 'credential')
  } catch (err) {
    console.error('platform setting save failed:', err)
    return Response.json({ error: 'Failed to save setting' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
