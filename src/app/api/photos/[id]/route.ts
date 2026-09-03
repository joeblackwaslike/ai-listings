import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  // Verify ownership: photo must belong to a listing owned by this user
  const { data: photo } = await supabase
    .from('photos')
    .select('id, listing_id, listings!inner(user_id)')
    .eq('id', id)
    .eq('listings.user_id', user.id)
    .single()

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabase.from('photos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
