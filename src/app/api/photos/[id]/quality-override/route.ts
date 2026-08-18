import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { getUserApiKeys } from '@/lib/user-api-keys'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: photoRow } = await supabase
    .from('photos')
    .select('id, listing_id, type, raw_url, photoroom_meta, listings!inner(user_id, skip_background_removal)')
    .eq('id', id)
    .eq('listings.user_id', user.id)
    .single()

  if (!photoRow) return Response.json({ error: 'Not found' }, { status: 404 })

  const photoroomMeta = photoRow.photoroom_meta as Record<string, unknown> | null

  // Only a studio photo that actually failed the quality check is eligible for override --
  // running this against any other photo type (e.g. intake) would set processed_url on a
  // photo nothing else expects that on, and dashboard/page.tsx picks the listing's cover from
  // the first processed_url found across ALL photo types.
  if (photoRow.type !== 'studio' || photoroomMeta?.quality_failed !== true) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const listingRow = photoRow.listings as unknown as {
    user_id: string
    skip_background_removal: boolean
  }

  // Run background removal (if applicable) *before* writing the override flags below --
  // removeBackground unconditionally overwrites photoroom_meta to `{}` once it finishes, so
  // doing it first and letting our own update land last is what keeps quality_overridden from
  // getting silently wiped out.
  if (!listingRow.skip_background_removal) {
    const apiKeys = await getUserApiKeys(listingRow.user_id)
    const storagePath = `studio/${photoRow.listing_id}/processed-${id}-override.png`
    try {
      await removeBackground(id, photoRow.raw_url as string, storagePath, apiKeys)
    } catch (err) {
      console.error('quality-override background removal failed:', err)
      return Response.json({ error: 'Failed to process photo' }, { status: 500 })
    }
  }

  const { error: updateError } = await supabase
    .from('photos')
    .update({
      photoroom_meta: {
        ...photoroomMeta,
        quality_failed: false,
        quality_overridden: true,
      },
    })
    .eq('id', id)

  // Reconcile agent_blocked regardless of whether the metadata update above succeeded --
  // removeBackground already wiped this photo's quality_failed flag as a side effect the
  // moment it ran, so the listing's true outstanding-issues count may already be zero even
  // if the follow-up update below fails. Skipping this on that failure could strand the
  // listing agent_blocked forever with no photo left in the checklist to explain why.
  //
  // Guard against a failed count query (count is null on error) the same way
  // reconcileQualityEscalation does in photo-quality-gate.ts -- otherwise a transient
  // failure here reads identically to "confirmed zero outstanding issues" and would
  // silently clear agent_blocked.
  const { count, error: countError } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', photoRow.listing_id)
    .eq('type', 'studio')
    .eq('photoroom_meta->>quality_failed', 'true')

  if (!countError && count === 0) {
    const { error: unblockError } = await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', photoRow.listing_id)
    if (unblockError) {
      // The underlying quality-failed state is already resolved (count === 0), but the write
      // to actually clear agent_blocked failed -- the listing stays visibly blocked with no
      // actionable checklist item. Self-heals on the next studio-photo upload (which re-runs
      // photo-quality-gate.ts's own independent reconciliation), but log so it's diagnosable
      // in the meantime rather than silent.
      console.error(`quality-override: failed to clear agent_blocked for listing ${photoRow.listing_id} after resolving quality-failed count to zero:`, unblockError)
    }
  }

  if (updateError) {
    return Response.json({ error: 'Failed to update photo' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
