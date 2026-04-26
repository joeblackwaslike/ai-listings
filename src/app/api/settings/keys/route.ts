import { createClient } from '@/lib/supabase/server'
import { VALID_PROVIDER_IDS } from '@/lib/providers'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { provider?: unknown; api_key?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { provider, api_key } = body

  if (typeof provider !== 'string' || !VALID_PROVIDER_IDS.includes(provider)) {
    return Response.json({ error: 'provider must be one of: anthropic, serpapi, photoroom' }, { status: 400 })
  }

  if (typeof api_key !== 'string' || api_key.trim() === '') {
    return Response.json({ error: 'api_key must be a non-empty string' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_api_keys')
    .upsert(
      { user_id: user.id, provider, api_key: api_key.trim() },
      { onConflict: 'user_id,provider' }
    )

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
