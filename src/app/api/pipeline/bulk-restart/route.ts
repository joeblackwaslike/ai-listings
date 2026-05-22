import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()

  // Find all blocked listings for this user that have an intake photo
  const { data: blocked, error } = await admin
    .from('listings')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('agent_blocked', true)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!blocked || blocked.length === 0) return Response.json({ restarted: 0 })

  const listingIds = blocked.map((r: { id: string }) => r.id)

  // Fetch intake photos for these listings
  const { data: photos } = await admin
    .from('photos')
    .select('listing_id, raw_url')
    .in('listing_id', listingIds)
    .eq('type', 'intake')

  const photoByListing = Object.fromEntries(
    (photos ?? []).map((p: { listing_id: string; raw_url: string }) => [p.listing_id, p.raw_url])
  )

  // Clear blocked state before re-firing so onFailure doesn't double-write
  await admin
    .from('listings')
    .update({ agent_blocked: false, agent_blocked_reason: null, status: 'processing' })
    .in('id', listingIds)

  const events = listingIds
    .filter((id: string) => photoByListing[id])
    .map((id: string) => ({
      name: 'photo/uploaded' as const,
      data: {
        listingId: id,
        photoUrl: photoByListing[id] as string,
        uploadedAt: new Date().toISOString(),
      },
    }))

  if (events.length > 0) {
    await inngest.send(events)
  }

  return Response.json({ restarted: events.length, skipped: listingIds.length - events.length })
}
