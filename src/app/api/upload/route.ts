import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import sharp from 'sharp'
import { inngest } from '@/lib/inngest/client'
import { uploadFile } from '@/lib/storage'
import { applyGrayWorldWhiteBalance } from '@/lib/pipeline/white-balance'

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function resolveUser(request: Request) {
  const agentToken = process.env.AGENT_BYPASS_TOKEN
  if (agentToken && request.headers.get('x-agent-token') === agentToken) {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase.auth.admin.listUsers()
    const user = data.users.find((u) => u.email === process.env.ALLOWED_EMAILS?.split(',')[0])
    return user ?? null
  }
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  return user ?? null
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const user = await resolveUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const file = formData.get('photo') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
  }

  let ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  const isHeic =
    ['heic', 'heif'].includes(ext) ||
    ['image/heic', 'image/heif'].includes((file.type ?? '').toLowerCase())

  const supabase = getSupabaseAdmin()
  let rawBuffer = Buffer.from(await file.arrayBuffer())

  if (isHeic) {
    rawBuffer = Buffer.from(await sharp(rawBuffer).png().toBuffer())
    ext = 'png'
  }

  // Auto-rotate per EXIF orientation. normalise() previously ran here too, but its
  // percentile-based histogram stretch darkens already well-exposed photos (it assumes the
  // input under-uses the 0-255 range, which most phone camera photos don't) -- confirmed via
  // a controlled before/after brightness measurement on a real photo (ai-listings-orp).
  rawBuffer = Buffer.from(await sharp(rawBuffer).rotate().toBuffer())

  // Gray-world color-cast correction -- see white-balance.ts for why this differs from normalise().
  rawBuffer = Buffer.from(await applyGrayWorldWhiteBalance(rawBuffer))

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .insert({ status: 'intake', pipeline_step: 0, pipeline_total: 5, user_id: user.id })
    .select('id')
    .single()

  if (listingError || !listing) {
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }

  const listingId: string = listing.id
  const storagePath = `intake/${listingId}/original.${ext}`

  const contentType = ext === 'png' ? 'image/png' : (file.type || 'image/jpeg')
  let photoUrl: string
  try {
    photoUrl = await uploadFile(storagePath, rawBuffer, contentType)
  } catch {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: photoRow, error: photoError } = await supabase
    .from('photos')
    .insert({
      listing_id: listingId,
      type: 'intake',
      raw_url: photoUrl,
      display_order: 0,
    })
    .select('id')
    .single()

  if (photoError || !photoRow) {
    return NextResponse.json({ error: 'Failed to create photo record' }, { status: 500 })
  }

  await inngest.send({
    name: 'photo/uploaded',
    data: {
      listingId,
      photoUrl,
      uploadedAt: new Date().toISOString(),
    },
  })

  return NextResponse.json({ listingId, photoUrl })
}
