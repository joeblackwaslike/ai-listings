import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { unblockedUpdate } from '@/lib/pipeline/pipeline-end'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  // Verify ownership
  const { data: listing } = await supabase
    .from('listings')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })

  // Approving copy resolves a failed rewrite, not a photo_quality block that still needs the seller.
  // Runs before the status flip so a failure here leaves the listing in copy_review and retryable.
  const { error: unblockError } = await supabase
    .from('listings')
    .update(unblockedUpdate())
    .eq('id', id)
    .eq('status', 'copy_review')
    .eq('agent_blocked_kind', 'rewrite_failed')
  if (unblockError) {
    console.error(`approve-copy: failed to clear rewrite_failed block for listing ${id}:`, unblockError)
    return Response.json({ error: 'Database error — please try again' }, { status: 500 })
  }

  // CAS: only advance if still in copy_review
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'in_loop', copy_approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'copy_review')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`approve-copy: DB error for listing ${id}:`, error)
    return Response.json({ error: 'Database error — please try again' }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ error: 'Listing is no longer in copy review' }, { status: 409 })
  }

  return Response.json({ ok: true })
}
