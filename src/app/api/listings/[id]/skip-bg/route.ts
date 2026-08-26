import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { processRawPhoto } from '@/lib/pipeline/process-raw-photo'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { categorySkipsBackgroundRemoval } from '@/lib/pipeline/step4b-photoroom'
import { getUserApiKeys } from '@/lib/user-api-keys'

type SessionSupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>
  }
}

export interface SkipBgDeps {
  processRaw?: typeof processRawPhoto
  removeBg?: typeof removeBackground
  getApiKeys?: typeof getUserApiKeys
}

// Exported separately from PATCH() so it can be exercised in tests against stub Supabase
// clients, without needing a Next.js request context or a real Supabase connection (matches
// the pattern in pipeline/bulk-restart/route.ts).
export async function handleSkipBg(
  sessionClient: SessionSupabaseClient,
  supabase: SupabaseClient,
  listingId: string,
  skip: boolean,
  deps: SkipBgDeps = {}
): Promise<Response> {
  const processRaw = deps.processRaw ?? processRawPhoto
  const removeBg = deps.removeBg ?? removeBackground
  const getApiKeys = deps.getApiKeys ?? getUserApiKeys

  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the listing belongs to the caller before updating with the admin client (RLS is bypassed here).
  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, skip_background_removal, category')
    .eq('id', listingId)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const turningSkipOn = skip && !listing.skip_background_removal
  const turningSkipOff = !skip && listing.skip_background_removal

  // The intake pipeline only produces processed_url once, at intake time, using whichever
  // path (background removal vs raw crop/denoise) skip_background_removal pointed to then.
  // Flipping the flag afterward doesn't retrigger that pipeline step, so without reprocessing
  // here every consumer of processed_url (PhotoPanel, PhotoSection, ListingCard) keeps showing
  // whichever variant was generated before the toggle, not the one the user just asked for.
  if (turningSkipOn || turningSkipOff) {
    const { data: photo, error: photoLookupError } = await supabase
      .from('photos')
      .select('id, raw_url, processed_url')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .maybeSingle()

    if (photoLookupError) {
      console.error(`skip-bg: failed to look up intake photo for listing ${listingId}:`, photoLookupError)
      return Response.json({ error: 'Failed to look up intake photo' }, { status: 500 })
    }

    // raw_url alone is the eligibility condition -- processed_url being unset is the normal,
    // permanent state for a listing whose skip_background_removal predates this PR (that's the
    // exact bug this PR backfills), not just a transient "still mid-pipeline" signal.
    if (photo?.raw_url) {
      const storagePath = `intake/${listingId}/processed-${photo.id}.png`
      // Jewelry never gets background-removed, regardless of the flag being toggled off --
      // matches the category-based exclusion step4b-photoroom.ts applies at intake time.
      const useRaw = turningSkipOn || categorySkipsBackgroundRemoval(listing.category)
      try {
        if (useRaw) {
          await processRaw(photo.id, photo.raw_url, storagePath)
        } else {
          const apiKeys = await getApiKeys(user.id)
          await removeBg(photo.id, photo.raw_url, storagePath, apiKeys)
        }
      } catch (err) {
        console.error(`skip-bg: failed to reprocess intake photo for listing ${listingId}:`, err)
        return Response.json({ error: 'Failed to reprocess photo' }, { status: 500 })
      }
    }
  }

  const { error } = await supabase
    .from('listings')
    .update({ skip_background_removal: skip })
    .eq('id', listingId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, skip })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const body = await req.json() as { skip: boolean }
  if (typeof body.skip !== 'boolean') {
    return Response.json({ error: 'skip must be boolean' }, { status: 400 })
  }

  const sessionClient = await createClient()
  const supabase = getSupabaseAdmin()

  return handleSkipBg(sessionClient, supabase, id, body.skip)
}
