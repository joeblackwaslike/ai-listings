import sharp from 'sharp'
import { getSupabaseAdmin } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toInternalUrl } from './to-public-url'

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

  const formData = new FormData()
  formData.append('file', new Blob([photoBuffer], { type: 'image/jpeg' }), 'photo.jpg')

  const wbgResponse = await fetch('https://api.withoutbg.com/v1.0/image-without-background', {
    method: 'POST',
    headers: { 'X-API-Key': apiKeys.withoutbg },
    body: formData,
  })

  if (!wbgResponse.ok) {
    const errText = await wbgResponse.text()
    throw new Error(`removeBackground: withoutBG returned HTTP ${wbgResponse.status} — ${errText}`)
  }

  const rawProcessedBuffer = Buffer.from(await wbgResponse.arrayBuffer())

  // Auto-crop to the non-transparent bounding box of the subject
  const processedBuffer = await sharp(rawProcessedBuffer).trim({ threshold: 10 }).toBuffer()

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, processedBuffer, { contentType: 'image/png', upsert: true })

  if (uploadError) {
    throw new Error(`removeBackground: Supabase storage upload failed — ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)

  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({ processed_url: urlData.publicUrl, photoroom_meta: {} })
    .eq('id', photoId)

  if (photoUpdateError) {
    throw new Error(`removeBackground: photos row update failed — ${photoUpdateError.message}`)
  }
}
