import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Measurements } from '@/types/listings'

const EDITABLE_KEYS = ['box_length_in', 'box_width_in', 'box_height_in', 'weight_oz'] as const
type EditableKey = (typeof EDITABLE_KEYS)[number]

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const patch: Partial<Record<EditableKey, number>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEditableKey(key)) {
      return Response.json({ error: `Unknown measurement key: ${key}` }, { status: 400 })
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return Response.json({ error: `${key} must be a positive number` }, { status: 400 })
    }
    patch[key] = value
  }

  const supabase = getSupabaseAdmin()

  // Verify the listing belongs to the caller before updating with the admin client (RLS is
  // bypassed here) -- same pattern as skip-bg/route.ts.
  // Known gap: this is read-then-merge-then-write in application code, not an atomic
  // DB-side merge -- two independent PATCH calls for the same listing (e.g. the box-dims
  // save and the weight save from the finalizing checklist UI) can race and silently lose
  // an update. Low-probability under this app's single-user-per-listing usage; tracked as
  // ai-listings-0en rather than fixed here (a proper fix needs a Postgres-side JSONB merge,
  // which is out of scope for this plan's "no new migrations" design).
  const { data: current } = await supabase
    .from('listings')
    .select('measurements, user_id')
    .eq('id', id)
    .single()

  if (!current || current.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const merged: Measurements = { ...(current.measurements as Measurements | null ?? {}), ...patch }

  // Known-value-first: a real measured box overrides the padded estimate once all three
  // dimensions are known -- see Feature 3's "Estimated shipping box" in the spec.
  if (merged.box_length_in != null && merged.box_width_in != null && merged.box_height_in != null) {
    merged.estimated_shipping_box = {
      length: merged.box_length_in,
      width: merged.box_width_in,
      height: merged.box_height_in,
    }
  }

  const { error } = await supabase
    .from('listings')
    .update({ measurements: merged })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, measurements: merged })
}
