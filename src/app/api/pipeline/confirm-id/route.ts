import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import {
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  synthesizeIdGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { IdGateListing } from '@/lib/pipeline/gate-messages'
import { insertConversationRowsSequentially } from '@/lib/pipeline/insert-conversation-rows'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    listingId?: string
    confirmed?: boolean
    corrections?: string | null
  }

  if (!body.listingId || body.confirmed === undefined) {
    return NextResponse.json(
      { error: 'listingId and confirmed are required' },
      { status: 400 }
    )
  }

  // Stamp intake immediately so the card stops showing the overlay even
  // before Inngest processes the event (which takes a few seconds). RLS
  // (owner_access on listings) scopes this update to the caller's own rows --
  // a non-owner's request matches zero rows and updatedListing stays null.
  const { data: updatedListing, error: updateError } = await supabase
    .from('listings')
    .update({ status: 'intake' })
    .eq('id', body.listingId)
    .eq('status', 'id_gate')
    .select('id, brand, category, condition, condition_notes, intake_meta')
    .maybeSingle()

  if (updateError) {
    console.error('confirm-id: status update failed for listing', body.listingId, updateError.message)
  }

  if (!updatedListing) {
    return NextResponse.json({ ok: true })
  }

  const listing = updatedListing as unknown as IdGateListing
  const confirmed = body.confirmed
  const corrections = body.corrections ?? null

  await insertConversationRowsSequentially(
    supabase,
    [
      {
        listing_id: body.listingId,
        role: 'assistant',
        content: buildIdGatePrompt(listing),
        context_snapshot: buildIdGateSnapshot(listing),
      },
      {
        listing_id: body.listingId,
        role: 'user',
        content: synthesizeIdGateAnswer({ confirmed, corrections, listing }),
        context_snapshot: { confirmed, corrections },
      },
      {
        listing_id: body.listingId,
        role: 'assistant',
        content: buildIdGateAck({ confirmed }),
        context_snapshot: null,
      },
    ],
    (error) => console.error('confirm-id: failed to persist gate conversation for listing', body.listingId, error.message)
  )

  await inngest.send({
    name: 'pipeline/id-confirmed',
    data: {
      listingId: body.listingId,
      confirmed: body.confirmed,
      corrections: body.corrections ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
