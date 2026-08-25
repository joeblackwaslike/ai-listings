import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './supabase-push'
import { toInternalUrl } from './to-public-url'
import { uploadFile } from '@/lib/storage'
import { cropDenoiseAndFlatten } from './crop-denoise'

export interface ProcessRawPhotoDeps {
  supabase?: SupabaseClient
  fetchPhoto?: typeof fetch
  upload?: typeof uploadFile
}

// Lightweight processing path for photos that skip background removal (jewelry category, or
// listings with skip_background_removal set) -- these photos previously never got a
// processed_url at all (step4b-photoroom.ts returned immediately, leaving the column
// unpopulated and every consumer falling back to raw_url). Applies the same crop + denoise
// treatment as the background-removal path (remove-background.ts), just without the
// bg-removal API call.
export async function processRawPhoto(
  photoId: string,
  photoUrl: string,
  storagePath: string,
  deps: ProcessRawPhotoDeps = {}
): Promise<void> {
  const supabase = deps.supabase ?? getSupabaseAdmin()
  const fetchPhoto = deps.fetchPhoto ?? fetch
  const upload = deps.upload ?? uploadFile

  const photoResponse = await fetchPhoto(toInternalUrl(photoUrl))
  if (!photoResponse.ok) {
    throw new Error(`processRawPhoto: failed to download photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  const processedBuffer = await cropDenoiseAndFlatten(Buffer.from(photoBuffer))

  const processedUrl = await upload(storagePath, processedBuffer, 'image/jpeg')

  const { data: updatedRows, error: photoUpdateError } = await supabase
    .from('photos')
    .update({ processed_url: processedUrl })
    .eq('id', photoId)
    .select('id')

  if (photoUpdateError) {
    throw new Error(`processRawPhoto: photos row update failed — ${photoUpdateError.message}`)
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new Error(
      `processRawPhoto: no photos row matched id ${photoId} — uploaded ${processedUrl} is now orphaned`
    )
  }
}
