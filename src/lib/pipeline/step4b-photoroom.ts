import { getSupabaseAdmin } from './supabase-push'

interface PhotoRoomResponse {
  result_b64: string
  foreground_top: number
  foreground_left: number
  foreground_width: number
  foreground_height: number
  image_type: string
}

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const photoResponse = await fetch(photoUrl)
  if (!photoResponse.ok) {
    throw new Error(`step4b: failed to download intake photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  const formData = new FormData()
  formData.append(
    'image_file',
    new Blob([photoBuffer], { type: 'image/jpeg' }),
    'photo.jpg'
  )
  formData.append('output_type', 'white_background')
  formData.append('format', 'jpg')

  const photoroomResponse = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.PHOTOROOM_API_KEY!,
    },
    body: formData,
  })

  if (!photoroomResponse.ok) {
    const errText = await photoroomResponse.text()
    throw new Error(`step4b: PhotoRoom returned HTTP ${photoroomResponse.status} — ${errText}`)
  }

  const prData = (await photoroomResponse.json()) as PhotoRoomResponse
  const processedBuffer = Buffer.from(prData.result_b64, 'base64')
  const processedFilePath = `intake/${listingId}/processed.jpg`

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(processedFilePath, processedBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`step4b: Supabase storage upload failed — ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from('photos')
    .getPublicUrl(processedFilePath)

  const processedUrl = urlData.publicUrl

  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({
      processed_url: processedUrl,
      photoroom_meta: {
        foreground_top: prData.foreground_top,
        foreground_left: prData.foreground_left,
        foreground_width: prData.foreground_width,
        foreground_height: prData.foreground_height,
      },
    })
    .eq('id', intakePhotoId)

  if (photoUpdateError) {
    throw new Error(`step4b: photos row update failed — ${photoUpdateError.message}`)
  }
}
