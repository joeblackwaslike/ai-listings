import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}
