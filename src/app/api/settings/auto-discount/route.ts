import { createClient } from '@/lib/supabase/server'
import { getSettings, setSetting } from '@/lib/user-settings'

const AUTO_DISCOUNT_KEYS = [
  'auto_discount_enabled',
  'auto_discount_pct',
  'auto_discount_interval_days',
  'auto_discount_floor_pct',
] as const

const DEFAULTS = {
  enabled: false,
  pct: 10,
  intervalDays: 14,
  floorPct: 50,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const settings = await getSettings(user.id, [...AUTO_DISCOUNT_KEYS])
    return Response.json({
      enabled: settings['auto_discount_enabled'] != null
        ? settings['auto_discount_enabled'] === 'true'
        : DEFAULTS.enabled,
      pct: settings['auto_discount_pct'] != null
        ? parseFloat(settings['auto_discount_pct']) || DEFAULTS.pct
        : DEFAULTS.pct,
      intervalDays: settings['auto_discount_interval_days'] != null
        ? parseInt(settings['auto_discount_interval_days'], 10) || DEFAULTS.intervalDays
        : DEFAULTS.intervalDays,
      floorPct: settings['auto_discount_floor_pct'] != null
        ? parseFloat(settings['auto_discount_floor_pct']) || DEFAULTS.floorPct
        : DEFAULTS.floorPct,
    })
  } catch (err) {
    console.error('auto-discount settings fetch failed:', err)
    return Response.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { enabled?: boolean; pct?: number; intervalDays?: number; floorPct?: number }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (body.enabled !== undefined) {
      await setSetting(user.id, 'auto_discount_enabled', String(body.enabled), 'string')
    }
    if (body.pct !== undefined) {
      await setSetting(user.id, 'auto_discount_pct', String(body.pct), 'number')
    }
    if (body.intervalDays !== undefined) {
      await setSetting(user.id, 'auto_discount_interval_days', String(body.intervalDays), 'number')
    }
    if (body.floorPct !== undefined) {
      await setSetting(user.id, 'auto_discount_floor_pct', String(body.floorPct), 'number')
    }
  } catch (err) {
    console.error('auto-discount settings save failed:', err)
    return Response.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
