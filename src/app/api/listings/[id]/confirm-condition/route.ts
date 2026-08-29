import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'
import type { ConditionValue } from '@/types/listings'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { condition: ConditionValue; condition_notes: string; extra_notes: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { condition, condition_notes, extra_notes } = body

  if (!condition || typeof condition_notes !== 'string' || typeof extra_notes !== 'string') {
    return Response.json(
      { error: 'Missing required fields: condition, condition_notes, extra_notes' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  // Read existing status and prior field values to enforce the gate and enable revert on
  // inngest.send failure -- without a status check here, a stale retry or concurrent click
  // could fire a second description-rewrite that races an in-flight one.
  const { data: existing } = await supabase
    .from('listings')
    .select('status, condition, condition_notes, condition_confirmed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) return Response.json({ error: 'Listing not found' }, { status: 404 })

  if (existing.status !== 'condition_gate') {
    return Response.json({ error: 'listing is not in condition_gate status' }, { status: 409 })
  }

  const { data: updated, error } = await supabase
    .from('listings')
    .update({
      condition,
      condition_notes,
      condition_confirmed: true,
      status: 'in_loop',
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!updated) return Response.json({ error: 'Update did not match a listing you own' }, { status: 404 })

  try {
    await inngest.send({
      name: 'listing/condition-confirmed',
      data: { listingId: id, condition, conditionNotes: condition_notes, extraNotes: extra_notes },
    })
  } catch (err) {
    // Compensate so a retry can re-attempt dispatch -- revert status and condition_confirmed
    // back to the condition_gate state so the UI remains actionable. The condition and
    // condition_notes that came in with this request are safe to revert to prior values since
    // the pipeline never acted on them (inngest.send failed before any step ran).
    console.error(`confirm-condition: inngest.send failed for listing ${id}, reverting for retry:`, err)
    const { error: revertError } = await supabase
      .from('listings')
      .update({
        condition: existing.condition as ConditionValue,
        condition_notes: existing.condition_notes,
        condition_confirmed: existing.condition_confirmed ?? false,
        status: 'condition_gate',
      })
      .eq('id', id)
      .eq('user_id', user.id)
    if (revertError) {
      // Both the event dispatch AND the compensating revert failed -- a retry will see status
      // 'in_loop' and skip re-dispatch, so this listing needs manual DB intervention.
      console.error(
        `confirm-condition: revert ALSO failed for listing ${id} -- needs manual intervention:`,
        revertError
      )
    }
    return Response.json(
      { error: 'Failed to schedule description rewrite. Please try again.' },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
