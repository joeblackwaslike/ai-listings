import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const { photoId } = await params
  const { action } = await req.json() as { action: 'skip' | 'apply' }

  if (action !== 'skip' && action !== 'apply') {
    return NextResponse.json({ error: 'action must be skip or apply' }, { status: 400 })
  }

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

  if (action === 'skip') {
    await supabase
      .from('photos')
      .update({ processed_url: photo.raw_url })
      .eq('id', photoId)
  } else {
    await supabase
      .from('photos')
      .update({ processed_url: null })
      .eq('id', photoId)
    await inngest.send({
      name: 'studio/uploaded',
      data: { listingId: photo.listing_id as string, photoId, photoUrl: photo.raw_url as string },
    })
  }

  return NextResponse.json({ ok: true })
}
