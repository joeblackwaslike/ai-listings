import { inngest } from '../client'
import type { StudioPhotoProcessedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Listing, Photo } from '@/types/listings'

export interface ReadinessDecision {
  confirmNow: boolean
  batchReady: boolean
}

/**
 * Decides what a settled upload batch means for a listing: nothing while any studio photo
 * is still processing, otherwise a batch-ready signal, plus a first-time photo confirmation
 * if the listing hasn't been confirmed yet.
 */
export function decideReadiness(
  listing: Pick<Listing, 'photos_confirmed'>,
  photos: Pick<Photo, 'type' | 'processed_url'>[]
): ReadinessDecision {
  const studio = photos.filter((p) => p.type === 'studio')
  const allProcessed = studio.length > 0 && studio.every((p) => p.processed_url !== null)
  if (!allProcessed) return { confirmNow: false, batchReady: false }
  return { confirmNow: !listing.photos_confirmed, batchReady: true }
}

async function confirmPhotos(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  listingId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('listings')
    .update({ photos_confirmed: true, condition_confirmed: false })
    .eq('id', listingId)
    .eq('photos_confirmed', false)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`photo-readiness: confirm update failed — ${error.message}`)
  return data !== null
}

export const photoReadiness = inngest.createFunction(
  {
    id: 'photo-readiness',
    name: 'Photo Readiness',
    triggers: [{ event: 'listing/studio-photo-processed' }],
    debounce: { key: 'event.data.listingId', period: '30s' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { listingId } = (event as unknown as StudioPhotoProcessedEvent).data
    const supabase = getSupabaseAdmin()

    const decision = await step.run('decide-readiness', async () => {
      const [{ data: listing, error: listingError }, { data: photos, error: photosError }] = await Promise.all([
        supabase.from('listings').select('photos_confirmed').eq('id', listingId).maybeSingle(),
        supabase.from('photos').select('type, processed_url').eq('listing_id', listingId).eq('type', 'studio'),
      ])
      if (listingError || photosError) {
        throw new Error(`photo-readiness: load failed — ${(listingError ?? photosError)?.message}`)
      }
      if (!listing) return { confirmNow: false, batchReady: false }
      return decideReadiness(listing, photos ?? [])
    })

    if (!decision.batchReady) return { ok: true, listingId, ...decision }

    const firstConfirmation = decision.confirmNow
      ? await step.run('auto-confirm-photos', () => confirmPhotos(supabase, listingId))
      : false

    await step.sendEvent('emit-readiness-events', [
      ...(firstConfirmation ? [{ name: 'listing/photos-confirmed', data: { listingId } }] : []),
      { name: 'listing/studio-batch-ready', data: { listingId, firstConfirmation } },
    ])

    return { ok: true, listingId, firstConfirmation }
  }
)
