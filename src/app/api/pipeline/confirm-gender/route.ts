import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  synthesizeGenderGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { GenderGateListing } from '@/lib/pipeline/gate-messages'
import { insertConversationRowsSequentially } from '@/lib/pipeline/insert-conversation-rows'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    listingId?: string
    gender?: string | null
    measurements?: Record<string, unknown> | null
  }
  const { listingId, gender = null, measurements = null } = body

  if (!listingId) {
    return Response.json({ error: 'listingId is required' }, { status: 400 })
  }

  const { data, error: fetchError } = await supabase
    .from('listings')
    .select('status, category, intake_meta')
    .eq('id', listingId)
    .maybeSingle()
  if (fetchError) {
    console.error('confirm-gender: listing fetch failed for listing', listingId, fetchError.message)
  }
  const listing = data as unknown as (GenderGateListing & { status: string }) | null

  if (!listing || listing.status !== 'gender_gate') {
    return Response.json({ ok: true })
  }

  // Stamp in_loop immediately, same as confirm-id stamps intake -- intake-pipeline.ts
  // doesn't write status again until step3/4/5 all finish, so without this the dashboard
  // pill kept showing "Needs details" for the entire remaining pipeline run after the user
  // had already answered, with no way to tell "still waiting on you" apart from "answered,
  // now processing" (ai-listings dashboard report, 2026-08-23). 'in_loop' is the correct
  // target value regardless -- StatusBadge already treats it as covering everything from
  // here through the automated steps finishing.
  const { error: statusError } = await supabase
    .from('listings')
    .update({ status: 'in_loop' })
    .eq('id', listingId)
    .eq('status', 'gender_gate')
  if (statusError) {
    console.error('confirm-gender: status update failed for listing', listingId, statusError.message)
  }

  const { message, detailGateContext } = buildGenderGatePrompt(listing)

  // The listing detail page's SSR render persists this exact prompt via the same atomic
  // RPC on essentially every page load while status stays 'gender_gate' (initial load,
  // AutoRefresh's 30s tick, tab refocus) -- measurements take a minute+ to fill in, so
  // AutoRefresh reliably fires at least once before submit. Re-inserting it here
  // unconditionally (as part of insertConversationRowsSequentially below) duplicated it
  // seconds apart (HB-0128, 2026-08-23). Routing through insert_conversation_if_new lets
  // it dedupe against whatever the SSR path already wrote.
  const { error: promptError } = await supabase.rpc('insert_conversation_if_new', {
    p_listing_id: listingId,
    p_role: 'assistant',
    p_content: message,
  })
  if (promptError) {
    console.error('confirm-gender: failed to persist gate prompt for listing', listingId, promptError.message)
  }

  await insertConversationRowsSequentially(
    supabase,
    [
      {
        listing_id: listingId,
        role: 'user',
        content: synthesizeGenderGateAnswer({ gender, measurements, detailGateContext }),
        context_snapshot: { gender, measurements },
      },
      {
        listing_id: listingId,
        role: 'assistant',
        content: buildGenderGateAck(),
        context_snapshot: null,
      },
    ],
    (error) => console.error('confirm-gender: failed to persist gate conversation for listing', listingId, error.message)
  )

  // RLS (owner_access on listings) already scoped the SELECT above to the caller's own
  // rows -- a non-owner's listingId returns null and we return early before this point,
  // so a cross-tenant request never reaches inngest.send.
  await inngest.send({
    name: 'pipeline/gender-confirmed',
    data: { listingId, gender, measurements },
  })

  return Response.json({ ok: true })
}
