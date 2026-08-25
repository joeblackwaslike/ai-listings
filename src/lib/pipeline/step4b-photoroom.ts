import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeys } from '@/lib/user-api-keys'
import { removeBackground } from './remove-background'
import { processRawPhoto } from './process-raw-photo'
import { getSupabaseAdmin } from './supabase-push'

// Categories where background removal makes the item look worse (chains, delicate jewelry)
const SKIP_BG_REMOVAL = new Set(['jewelry'])

export interface PhotoRoomDeps {
  supabase?: SupabaseClient
  processRaw?: typeof processRawPhoto
  removeBg?: typeof removeBackground
}

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string,
  apiKeys: ApiKeys,
  category?: string,
  deps: PhotoRoomDeps = {}
): Promise<void> {
  const processRaw = deps.processRaw ?? processRawPhoto
  const removeBg = deps.removeBg ?? removeBackground

  // Keyed by intakePhotoId, not just listingId -- a shared static key here would let
  // concurrent/multiple photo outputs for the same listing overwrite or target the wrong
  // storage object (codexreviewbot, PR #56). Matches the per-photo key already used for
  // studio photos in photo-quality-gate.ts.
  const storagePath = `intake/${listingId}/processed-${intakePhotoId}.png`

  // Background removal is skipped for these cases, but the photo still needs its raw borders
  // cropped and noise reduced before it becomes processed_url.
  if (category && SKIP_BG_REMOVAL.has(category.toLowerCase())) {
    await processRaw(intakePhotoId, photoUrl, storagePath)
    return
  }

  const supabase = deps.supabase ?? getSupabaseAdmin()
  const { data: row } = await supabase
    .from('listings')
    .select('skip_background_removal')
    .eq('id', listingId)
    .single()
  if (row?.skip_background_removal) {
    await processRaw(intakePhotoId, photoUrl, storagePath)
    return
  }

  await removeBg(intakePhotoId, photoUrl, storagePath, apiKeys)
}
