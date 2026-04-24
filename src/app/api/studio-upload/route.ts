import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'

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

  if (!file || !listingId) {
    return NextResponse.json({ error: 'photo and listingId required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const timestamp = Date.now()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `studio/${listingId}/${timestamp}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)
  const photoUrl = urlData.publicUrl

  const { data: photoRow, error: photoError } = await supabase
    .from('photos')
    .insert({
      listing_id: listingId,
      type: 'studio',
      raw_url: photoUrl,
      display_order: timestamp,
    })
    .select('id')
    .single()

  if (photoError || !photoRow) {
    return NextResponse.json({ error: 'Failed to create photo record' }, { status: 500 })
  }

  await inngest.send({
    name: 'studio/uploaded',
    data: {
      listingId,
      photoId: photoRow.id as string,
      photoUrl,
    },
  })

  return NextResponse.json({ photoId: photoRow.id, photoUrl })
}
