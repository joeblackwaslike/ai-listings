import { getSupabaseAdmin } from './supabase-push'
import { toInternalUrl } from './to-public-url'
import { uploadFile } from '@/lib/storage'
import { cropDenoiseAndFlatten } from './crop-denoise'

// Lightweight processing path for photos that skip background removal (jewelry category, or
// listings with skip_background_removal set) -- these raw photos previously went straight to
// processed_url with zero processing. Applies the same crop + denoise treatment as the
// background-removal path (remove-background.ts), just without the bg-removal API call.
export async function processRawPhoto(
  photoId: string,
  photoUrl: string,
  storagePath: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const photoResponse = await fetch(toInternalUrl(photoUrl))
  if (!photoResponse.ok) {
    throw new Error(`processRawPhoto: failed to download photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  const processedBuffer = await cropDenoiseAndFlatten(Buffer.from(photoBuffer))

  const processedUrl = await uploadFile(storagePath, processedBuffer, 'image/jpeg')

  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({ processed_url: processedUrl })
    .eq('id', photoId)

  if (photoUpdateError) {
    throw new Error(`processRawPhoto: photos row update failed — ${photoUpdateError.message}`)
  }
}
