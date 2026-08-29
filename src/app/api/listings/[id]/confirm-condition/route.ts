import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'
import type { ConditionValue } from '@/types/listings'

const VALID_CONDITIONS = [
  'new_with_tags', 'new_without_tags', 'like_new', 'very_good',
  'good', 'fair', 'poor', 'for_parts',
] as const

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

  if (!(VALID_CONDITIONS as ReadonlyArray<string>).includes(condition)) {
    return Response.json({ error: 'invalid condition value' }, { status: 400 })
  }
  if (condition_notes.length > 2000) {
    return Response.json({ error: 'condition_notes too long' }, { status: 400 })
  }
  if (extra_notes.length > 2000) {
    return Response.json({ error: 'extra_notes too long' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Read prior field values for compensation (revert) if inngest.send fails.
  // Status is enforced atomically by the compare-and-swap update below — no separate
  // status check here to avoid TOCTOU from double-clicks or concurrent tabs.
  const { data: existing } = await supabase
    .from('listings')
    .select('condition, condition_notes, condition_confirmed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) return Response.json({ error: 'Listing not found' }, { status: 404 })

  // Atomic gate: update only when status is currently condition_gate, then check affected rows.
  // Both reads can see condition_gate; only one update wins. The second finds no matching row
  // and gets 409. The listing stays in condition_gate — status advances to in_loop only after
  // the description-rewrite Inngest step completes successfully.
  const { data: updatedListing, error: updateError } = await supabase
    .from('listings')
    .update({
      condition,
      condition_notes,
      condition_confirmed: true,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'condition_gate')
    .select('id')
    .maybeSingle()

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 })
  if (!updatedListing) return Response.json({ error: 'listing is not in condition_gate status' }, { status: 409 })

  try {
    await inngest.send({
      name: 'listing/condition-confirmed',
      data: { listingId: id, condition, conditionNotes: condition_notes, extraNotes: extra_notes },
    })
  } catch (err) {
    // Compensate so a retry can re-attempt dispatch — revert condition fields so the UI
    // remains actionable. Status stays condition_gate (the update above did not change it).
    console.error(`confirm-condition: inngest.send failed for listing ${id}, reverting for retry:`, err)
    const { error: revertError } = await supabase
      .from('listings')
      .update({
        condition: existing.condition as ConditionValue,
        condition_notes: existing.condition_notes,
        condition_confirmed: existing.condition_confirmed ?? false,
      })
      .eq('id', id)
      .eq('user_id', user.id)
    if (revertError) {
      // Both the event dispatch AND the compensating revert failed — the listing is stuck with
      // condition_confirmed=true but no rewrite scheduled; needs manual DB intervention.
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
