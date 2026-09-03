import { inngest } from '../client'
import type { StudioUploadedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { processRawPhoto } from '@/lib/pipeline/process-raw-photo'
import { categorySkipsBackgroundRemoval } from '@/lib/pipeline/step4b-photoroom'
import { getUserApiKeys } from '@/lib/user-api-keys'

async function supersedeReplacedPhoto(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string,
  replacesPhotoId: string | undefined
): Promise<void> {
  if (!replacesPhotoId) return
  await supabase
    .from('photos')
    .delete()
    .eq('id', replacesPhotoId)
    .eq('listing_id', listingId)
    .eq('type', 'studio')
    .eq('photoroom_meta->>quality_failed', 'true')
}

async function reconcileQualityEscalation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string
): Promise<void> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId)
    .eq('type', 'studio')
    .eq('photoroom_meta->>quality_failed', 'true')

  if (!error && count === 0) {
    await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', listingId)
  }
}

export const photoQualityGate = inngest.createFunction(
  {
    id: 'photo-quality-gate',
    name: 'Photo Quality Gate',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 1,
    concurrency: { limit: 1, key: 'event.data.listingId' },
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl: _photoUrl, replacesPhotoId } = (
      event as unknown as StudioUploadedEvent
    ).data

    const supabase = getSupabaseAdmin()

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal, category')
      .eq('id', listingId)
      .single()

    const { data: photoRow } = await supabase
      .from('photos')
      .select('raw_url')
      .eq('id', photoId)
      .single()

    if (!photoRow?.raw_url) {
      throw new Error(`photo-quality-gate: photo ${photoId} has no raw_url`)
    }

    const storagePath = `studio/${listingId}/processed-${photoId}.png`

    if (listingRow?.skip_background_removal || categorySkipsBackgroundRemoval(listingRow?.category)) {
      await processRawPhoto(photoId, photoRow.raw_url as string, storagePath)
      await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, listingId, replacesPhotoId))
      await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId))
      await step.sendEvent('trigger-condition-reassessment', {
        name: 'listing/photos-confirmed',
        data: { listingId },
      })
      return { ok: true, listingId, photoId, skipped: true }
    }

    const apiKeys = await getUserApiKeys(listingRow?.user_id ?? null)
    await removeBackground(photoId, photoRow.raw_url as string, storagePath, apiKeys)

    await step.run('supersede-replaced-photo', () => supersedeReplacedPhoto(supabase, listingId, replacesPhotoId))
    await step.run('reconcile-quality-escalation', () => reconcileQualityEscalation(supabase, listingId))
    await step.sendEvent('trigger-condition-reassessment', {
      name: 'listing/photos-confirmed',
      data: { listingId },
    })

    return { ok: true, listingId, photoId }
  }
)
