import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    auto_discount_enabled?: boolean | null
    auto_discount_pct?: number | null
    auto_discount_interval_days?: number | null
  }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Verify the listing belongs to the authenticated user
  const supabase = getSupabaseAdmin()
  const { data: listing, error: fetchError } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', id)
    .single()

  if (fetchError || !listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }
  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, boolean | number | null> = {}
  if ('auto_discount_enabled' in body) update['auto_discount_enabled'] = body.auto_discount_enabled ?? null
  if ('auto_discount_pct' in body) update['auto_discount_pct'] = body.auto_discount_pct ?? null
  if ('auto_discount_interval_days' in body) update['auto_discount_interval_days'] = body.auto_discount_interval_days ?? null

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('listings')
    .update(update)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
