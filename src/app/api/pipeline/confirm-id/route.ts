import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'
import {
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  synthesizeIdGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { IdGateListing } from '@/lib/pipeline/gate-messages'

export async function POST(request: Request) {
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
  // before Inngest processes the event (which takes a few seconds).
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: updatedListing } = await supabase
    .from('listings')
    .update({ status: 'intake' })
    .eq('id', body.listingId)
    .eq('status', 'id_gate')
    .select('id, brand, category, condition, condition_notes, intake_meta')
    .maybeSingle()

  if (updatedListing) {
    const listing = updatedListing as unknown as IdGateListing
    const confirmed = body.confirmed
    const corrections = body.corrections ?? null

    const { error: insertError } = await supabase.from('conversations').insert([
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
    ])

    if (insertError) {
      console.error('confirm-id: failed to persist gate conversation:', insertError.message)
    }
  }

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
