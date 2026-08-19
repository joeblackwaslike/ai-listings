import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { estimatedShippingBoxFromMeasuredBox } from '@/lib/sizing/shipping-box'
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

  // Atomic JSONB merge (ai-listings-0en) -- replaces the prior read-then-merge-then-write
  // pattern, which could silently lose a concurrent PATCH's fields (e.g. the box-dims save
  // and the weight save from the finalizing checklist UI racing each other). Ownership is
  // enforced inside the RPC's WHERE clause, so a mismatched/missing owner returns NULL.
  const { data: merged, error } = await supabase.rpc('merge_listing_measurements', {
    p_listing_id: id,
    p_user_id: user.id,
    p_patch: patch,
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (merged === null) return Response.json({ error: 'Not found' }, { status: 404 })

  let measurements = merged as Measurements

  // Known-value-first: a real measured box overrides the padded estimate once all three
  // dimensions are known -- see Feature 3's "Estimated shipping box" in the spec. This is a
  // second, non-atomic RPC call, but only for the derived estimated_shipping_box field, not
  // the user-authored patch above. Its failure is treated as non-fatal to the request -- the
  // first call's result (the user's actual patch) is already committed and is still a valid
  // response even if this follow-up errors; the box will simply be recomputed on the next
  // PATCH that touches box dims.
  const box = estimatedShippingBoxFromMeasuredBox(measurements)
  if (box) {
    const { data: mergedWithBox, error: boxError } = await supabase.rpc('merge_listing_measurements', {
      p_listing_id: id,
      p_user_id: user.id,
      p_patch: { estimated_shipping_box: box },
    })
    if (boxError) {
      console.error(`measurements route: estimated_shipping_box recompute failed for listing ${id} — ${boxError.message}`)
    } else if (mergedWithBox !== null) {
      measurements = mergedWithBox as Measurements
    }
  }

  return Response.json({ ok: true, measurements })
}
