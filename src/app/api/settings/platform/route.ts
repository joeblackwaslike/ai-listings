import { createClient } from '@/lib/supabase/server'
import { setSetting, PLATFORM_SETTING_KEYS } from '@/lib/user-settings'

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

  if (typeof key !== 'string' || !PLATFORM_SETTING_KEYS.has(key)) {
    return Response.json({ error: `key must be one of: ${[...PLATFORM_SETTING_KEYS].join(', ')}` }, { status: 400 })
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
