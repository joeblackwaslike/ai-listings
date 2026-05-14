import { getSupabaseAdmin } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toInternalUrl } from './to-public-url'

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const photoResponse = await fetch(toInternalUrl(photoUrl))
  if (!photoResponse.ok) {
    throw new Error(`step4b: failed to download intake photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  const formData = new FormData()
  formData.append('file', new Blob([photoBuffer], { type: 'image/jpeg' }), 'photo.jpg')

  const wbgResponse = await fetch('https://api.withoutbg.com/v1.0/image-without-background', {
    method: 'POST',
    headers: { 'X-API-Key': apiKeys.withoutbg },
    body: formData,
  })

  if (!wbgResponse.ok) {
    const errText = await wbgResponse.text()
    throw new Error(`step4b: withoutBG returned HTTP ${wbgResponse.status} — ${errText}`)
  }

  const processedBuffer = Buffer.from(await wbgResponse.arrayBuffer())
  const processedFilePath = `intake/${listingId}/processed.png`

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(processedFilePath, processedBuffer, { contentType: 'image/png', upsert: true })

  if (uploadError) {
    throw new Error(`step4b: Supabase storage upload failed — ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(processedFilePath)

  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({ processed_url: urlData.publicUrl, photoroom_meta: {} })
    .eq('id', intakePhotoId)

  if (photoUpdateError) {
    throw new Error(`step4b: photos row update failed — ${photoUpdateError.message}`)
  }
}
