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
    .select('photos_confirmed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const wasAlreadyConfirmed = existing?.photos_confirmed === true

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
      console.error(`confirm-photos: inngest.send failed for listing ${id}, reverting photos_confirmed for retry:`, err)
      await supabase.from('listings').update({ photos_confirmed: false }).eq('id', id).eq('user_id', user.id)
      return Response.json({ error: 'Failed to schedule condition re-assessment. Please try again.' }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}
