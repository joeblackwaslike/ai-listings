import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import { uploadFile } from '@/lib/storage'

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

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const timestamp = Date.now()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `studio/${listingId}/${timestamp}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  let photoUrl: string
  try {
    photoUrl = await uploadFile(storagePath, buffer, file.type || 'image/jpeg')
  } catch {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

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
