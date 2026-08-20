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

  const trimmedValue = value.trim()

  // The Poshmark cookie field expects a real browser Cookie header (name=value; name2=value2; ...).
  // A JWT-shaped or otherwise pair-less value sat here for months, silently returning zero
  // comps/notifications with no visible error anywhere -- this is a structural format check
  // (at least one name=value pair) that catches that class of mistake at save time; it can't
  // catch an expired-but-well-formed cookie, which only the live health-check probe can.
  //
  // Requires the whole trimmed value to be one or more "name=value" pairs separated by ";" --
  // unlike a bare includes('=') && includes(';') check, this accepts a single pair with no
  // semicolon (a valid one-cookie Cookie header) while still rejecting a JWT with a stray "="
  // or ";" appended (which would otherwise slip past a substring-only check).
  const COOKIE_PAIRS_RE = /^[^=;\s]+=[^;]+(;\s*[^=;\s]+=[^;]+)*;?\s*$/
  if (key === 'poshmark_cookies' && !COOKIE_PAIRS_RE.test(trimmedValue)) {
    return Response.json({
      error: `This doesn't look like a valid cookie string (expected "name=value; name2=value2" pairs). ` +
        'Log into poshmark.com, open DevTools → Network, click any poshmark.com request, and copy the full Cookie request header value.',
    }, { status: 400 })
  }

  try {
    await setSetting(user.id, key, trimmedValue, 'credential')
  } catch (err) {
    console.error('platform setting save failed:', err)
    return Response.json({ error: 'Failed to save setting' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
