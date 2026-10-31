import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { canFinalizeOrPublish } from '@/lib/publish-gate'
import type { Inclusion, Photo } from '@/types/listings'

export async function handleFinalize(sessionClient: SupabaseClient, supabase: SupabaseClient, id: string) {
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, status, photos_confirmed, copy_approved_at, condition_confirmed, inclusions')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('type, photoroom_meta')
    .eq('listing_id', id)
  if (photosError) return Response.json({ error: photosError.message }, { status: 500 })
  const gate = canFinalizeOrPublish(
    { ...listing, inclusions: (listing.inclusions ?? []) as unknown as Inclusion[] },
    (photoRows ?? []) as Pick<Photo, 'type' | 'photoroom_meta'>[]
  )
  if (!gate.ok) return Response.json({ error: gate.reason }, { status: 409 })

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return handleFinalize(await createClient(), getSupabaseAdmin(), id)
}
