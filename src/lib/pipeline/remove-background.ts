import { getSupabaseAdmin } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toInternalUrl } from './to-public-url'
import { uploadFile } from '@/lib/storage'
import { getBgRemovalProvider } from './bg-removal'
import { cropDenoiseAndFlatten } from './crop-denoise'

export async function removeBackground(
  photoId: string,
  photoUrl: string,
  storagePath: string,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const photoResponse = await fetch(toInternalUrl(photoUrl))
  if (!photoResponse.ok) {
    throw new Error(`removeBackground: failed to download photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  const provider = getBgRemovalProvider(apiKeys)
  const rawProcessedBuffer = await provider.removeBackground(Buffer.from(photoBuffer))

  // Auto-crop transparent borders, denoise, then flatten onto white (transparent PNG looks
  // terrible in UI)
  const processedBuffer = await cropDenoiseAndFlatten(rawProcessedBuffer)

  const processedUrl = await uploadFile(storagePath, processedBuffer, 'image/jpeg')

  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({ processed_url: processedUrl, photoroom_meta: {} })
    .eq('id', photoId)

  if (photoUpdateError) {
    throw new Error(`removeBackground: photos row update failed — ${photoUpdateError.message}`)
  }
}
