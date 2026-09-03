import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import sharp from 'sharp'
import '@/lib/sharp-config'
import { inngest } from '@/lib/inngest/client'
import { uploadFile } from '@/lib/storage'
import { applyGrayWorldWhiteBalance } from '@/lib/pipeline/white-balance'

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('photo') as File | null
  const listingId = formData.get('listingId') as string | null
  const replacesPhotoId = formData.get('replacesPhotoId') as string | null
  const displayOrderRaw = formData.get('displayOrder') as string | null
  const displayOrder = displayOrderRaw !== null ? parseInt(displayOrderRaw, 10) : null

  if (!file || !listingId) {
    return NextResponse.json({ error: 'photo and listingId required' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const sbCookies = cookieStore.getAll().filter(c => c.name.startsWith('sb-'))
  console.log('[studio-upload] auth attempt cookies:', sbCookies.map(c => c.name))

  const sessionClient = await createClient()
  let getResult = await sessionClient.auth.getUser()
  if (getResult.error?.name === 'AuthRetryableFetchError') {
    await new Promise(r => setTimeout(r, 150))
    getResult = await sessionClient.auth.getUser()
  }
  const { data: { user }, error: getUserError } = getResult
  if (!user) {
    console.error('[studio-upload] auth failed:', getUserError)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (replacesPhotoId) {
    const { data: replacedPhoto } = await sessionClient
      .from('photos')
      .select('id')
      .eq('id', replacesPhotoId)
      .eq('listing_id', listingId)
      .eq('type', 'studio')
      .eq('photoroom_meta->>quality_failed', 'true')
      .maybeSingle()
    if (!replacedPhoto) {
      return NextResponse.json({ error: 'replacesPhotoId does not reference a studio photo on this listing that failed quality review' }, { status: 400 })
    }
  }

  const supabase = getSupabaseAdmin()
  const timestamp = Date.now()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `studio/${listingId}/${timestamp}.${ext}`
  const resolvedDisplayOrder = displayOrder ?? timestamp

  let buffer = Buffer.from(await file.arrayBuffer())
  try {
    const preMeta = await sharp(buffer).metadata()
    console.log('[studio-upload] EXIF orientation:', preMeta.orientation ?? 'absent', 'dims:', preMeta.width, 'x', preMeta.height)
    buffer = Buffer.from(await sharp(buffer).rotate().toBuffer())
    const postMeta = await sharp(buffer).metadata()
    console.log('[studio-upload] after rotate dims:', postMeta.width, 'x', postMeta.height)
    buffer = Buffer.from(await applyGrayWorldWhiteBalance(buffer))
  } catch (err) {
    console.error('[studio-upload] image processing failed:', err)
    return NextResponse.json({ error: 'Image processing failed' }, { status: 500 })
  }

  let photoUrl: string
  try {
    photoUrl = await uploadFile(storagePath, buffer, file.type || 'image/jpeg')
  } catch (err) {
    console.error('[studio-upload] R2 upload failed:', err)
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: photoRow, error: photoError } = await supabase
    .from('photos')
    .insert({
      listing_id: listingId,
      type: 'studio',
      raw_url: photoUrl,
      display_order: resolvedDisplayOrder,
    })
    .select('id')
    .single()

  if (photoError || !photoRow) {
    console.error('[studio-upload] photo insert failed:', photoError)
    return NextResponse.json({ error: 'Failed to create photo record' }, { status: 500 })
  }

  try {
    await inngest.send({
      name: 'studio/uploaded',
      data: {
        listingId,
        photoId: photoRow.id as string,
        photoUrl,
        ...(replacesPhotoId ? { replacesPhotoId } : {}),
      },
    })
  } catch (err) {
    console.error('[studio-upload] inngest.send failed:', err)
  }

  return NextResponse.json({ photoId: photoRow.id, photoUrl })
}
