import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

type SessionSupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>
  }
}

const SETTABLE_STATUSES = new Set(['taken', 'pending'])

function rpcErrorStatus(message: string): number {
  if (/is verified and cannot change/.test(message)) return 409
  if (/^(shot|listing) not found/.test(message)) return 404
  return 500
}

/**
 * Sets one photo-plan shot to `taken` or `pending` through `set_photo_shot_status`, which
 * refuses to change a verified shot. Exported apart from PATCH() for stub-client tests.
 */
export async function handleShotStatusPatch(
  sessionClient: SessionSupabaseClient,
  supabase: SupabaseClient,
  listingId: string,
  body: unknown
): Promise<Response> {
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { shot, status } = (body ?? {}) as { shot?: unknown; status?: unknown }
  if (typeof shot !== 'string' || shot.length === 0) {
    return Response.json({ error: 'shot must be a non-empty string' }, { status: 400 })
  }
  if (typeof status !== 'string' || !SETTABLE_STATUSES.has(status)) {
    return Response.json({ error: "status must be 'taken' or 'pending'" }, { status: 400 })
  }

  const { data: listing, error: fetchErr } = await supabase
    .from('listings')
    .select('id')
    .eq('id', listingId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 })

  const { data: plan, error } = await supabase.rpc('set_photo_shot_status', {
    p_listing_id: listingId,
    p_shot: shot,
    p_status: status,
  })
  if (error) return Response.json({ error: error.message }, { status: rpcErrorStatus(error.message) })

  return Response.json({ ok: true, photo_plan: plan })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  return handleShotStatusPatch(await createClient(), getSupabaseAdmin(), id, body)
}
