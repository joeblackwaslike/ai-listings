import { createClient } from '@/lib/supabase/server'
import { getSetting, setSetting } from '@/lib/user-settings'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const unit = await getSetting(user.id, 'measurement_input_unit')
    return Response.json({ inputUnit: unit === 'metric' ? 'metric' : 'imperial' })
  } catch (err) {
    console.error('measurement settings fetch failed:', err)
    return Response.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { inputUnit?: 'imperial' | 'metric' }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.inputUnit !== 'imperial' && body.inputUnit !== 'metric') {
    return Response.json({ error: 'inputUnit must be "imperial" or "metric"' }, { status: 400 })
  }

  try {
    await setSetting(user.id, 'measurement_input_unit', body.inputUnit, 'string')
  } catch (err) {
    console.error('measurement settings save failed:', err)
    return Response.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
