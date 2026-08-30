import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import '@/lib/sharp-config'
import { uploadFile, getPublicUrl } from '@/lib/storage'

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function urlToPath(url: string): string {
  const base = process.env.R2_PUBLIC_URL!
  return url.replace(base + '/', '').split('?')[0]
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url.split('?')[0])
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: photoId } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAdmin()

  const { data: photo } = await supabase
    .from('photos')
    .select('id, listing_id, raw_url, processed_url')
    .eq('id', photoId)
    .single()

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id')
    .eq('id', photo.listing_id)
    .single()

  if (!listing || listing.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const v = Date.now()
  const updates: Record<string, string> = {}

  const rawPath = urlToPath(photo.raw_url as string)
  const rawBuf = await fetchImage(photo.raw_url as string)
  const rotatedRaw = await sharp(rawBuf).rotate(270).toBuffer()
  await uploadFile(rawPath, rotatedRaw, 'image/jpeg')
  updates.raw_url = `${getPublicUrl(rawPath)}?v=${v}`

  const rawBase = (photo.raw_url as string).split('?')[0]
  const processedBase = (photo.processed_url as string | null)?.split('?')[0]
  if (processedBase && processedBase !== rawBase) {
    const processedPath = urlToPath(photo.processed_url as string)
    const processedBuf = await fetchImage(photo.processed_url as string)
    const rotatedProcessed = await sharp(processedBuf).rotate(270).toBuffer()
    await uploadFile(processedPath, rotatedProcessed, 'image/png')
    updates.processed_url = `${getPublicUrl(processedPath)}?v=${v}`
  }

  await supabase.from('photos').update(updates).eq('id', photoId)

  return NextResponse.json({ ok: true })
}
