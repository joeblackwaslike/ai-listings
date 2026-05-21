import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'

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
  await supabase
    .from('listings')
    .update({ status: 'intake' })
    .eq('id', body.listingId)
    .eq('status', 'id_gate')

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
