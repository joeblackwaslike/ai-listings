import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  synthesizeGenderGateAnswer,
} from '@/lib/pipeline/gate-messages'
import type { GenderGateListing } from '@/lib/pipeline/gate-messages'

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

  if (listing && listing.status === 'gender_gate') {
    const { message, detailGateContext } = buildGenderGatePrompt(listing)

    const { error: insertError } = await supabase.from('conversations').insert([
      {
        listing_id: listingId,
        role: 'assistant',
        content: message,
        context_snapshot: detailGateContext,
      },
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
    ])

    if (insertError) {
      console.error('confirm-gender: failed to persist gate conversation for listing', listingId, insertError.message)
    }
  }

  await inngest.send({
    name: 'pipeline/gender-confirmed',
    data: { listingId, gender, measurements },
  })

  return Response.json({ ok: true })
}
