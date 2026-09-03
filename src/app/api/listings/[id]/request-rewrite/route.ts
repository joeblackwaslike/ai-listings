import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { extra_notes?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const extraNotes = (body.extra_notes ?? '').trim()
  if (extraNotes.length > 2000) {
    return Response.json({ error: 'extra_notes too long (max 2000 chars)' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify ownership + status
  const { data: listing } = await supabase
    .from('listings')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.status !== 'copy_review') {
    return Response.json({ error: 'Listing is not in copy review' }, { status: 409 })
  }

  await inngest.send({
    name: 'listing/rewrite-requested',
    data: { listingId: id, extraNotes },
  })

  return Response.json({ ok: true }, { status: 202 })
}
