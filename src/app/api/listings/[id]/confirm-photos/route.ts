import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: existing } = await supabase
    .from('listings')
    .select('photos_confirmed, condition_confirmed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const wasAlreadyConfirmed = existing?.photos_confirmed === true
  const priorConditionConfirmed = existing?.condition_confirmed ?? true

  const { data: updated, error } = await supabase
    .from('listings')
    .update({ photos_confirmed: true, condition_confirmed: false })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Only fire the downstream event once we've confirmed the update actually matched a row
  // this caller owns -- condition-reassessment.ts trusts listingId completely once it
  // receives this event (same class of gap PR #35 fixed for confirm-id/confirm-gender) --
  // AND only on a genuine false->true transition, so a retry/double-click that finds
  // photos_confirmed already true doesn't re-trigger an expensive Claude call or create a
  // duplicate reassessment run that could race an in-flight one.
  if (updated && !wasAlreadyConfirmed) {
    try {
      await inngest.send({ name: 'listing/photos-confirmed', data: { listingId: id } })
    } catch (err) {
      // Compensate so a retry can re-attempt dispatch -- without this, a transient failure to
      // enqueue leaves the listing at photos_confirmed=true forever, and the next PATCH sees
      // wasAlreadyConfirmed=true and never re-fires the event, permanently stranding condition
      // re-assessment (and the Finalize gate that depends on it) with no recovery path.
      // Revert BOTH fields this same request set, not just photos_confirmed -- otherwise a
      // failed dispatch leaves condition_confirmed stuck at a stale false even though no
      // reassessment ever actually ran, which can surface a meaningless "pending approval" UI
      // for whatever condition value happened to be on the row from an earlier cycle.
      console.error(`confirm-photos: inngest.send failed for listing ${id}, reverting for retry:`, err)
      const { error: revertError } = await supabase
        .from('listings')
        .update({ photos_confirmed: false, condition_confirmed: priorConditionConfirmed })
        .eq('id', id)
        .eq('user_id', user.id)
      if (revertError) {
        // Both the event dispatch AND the compensating revert failed -- a retry will now see
        // photos_confirmed already true and skip re-dispatch, so this listing needs manual
        // attention (a direct DB fix or a fresh studio-photo upload, which re-triggers
        // photo-quality-gate.ts's own independent reconciliation). Log loudly since there's no
        // automated recovery path for a double failure this narrow.
        console.error(`confirm-photos: revert ALSO failed for listing ${id} -- listing may be permanently stuck, needs manual intervention:`, revertError)
      }
      return Response.json({ error: 'Failed to schedule condition re-assessment. Please try again.' }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}
