import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

interface ReorderUpdate {
  id: string
  display_order: number
}

export async function POST(request: Request) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { updates } = await request.json() as { updates: ReorderUpdate[] }
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'Invalid updates' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify all photos belong to listings owned by this user
  const ids = updates.map((u) => u.id)
  const { data: photos } = await supabase
    .from('photos')
    .select('id, listings!inner(user_id)')
    .in('id', ids)
    .eq('listings.user_id', user.id)

  if (!photos || photos.length !== ids.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Bulk update display_order
  const results = await Promise.all(
    updates.map(({ id, display_order }) =>
      supabase.from('photos').update({ display_order }).eq('id', id)
    )
  )

  const failed = results.find((r) => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
