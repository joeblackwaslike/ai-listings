import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { reconcileInclusionsPlan } from '@/lib/pipeline/reconcile-inclusions-plan'
import type { Inclusion, PhotoShot } from '@/types/listings'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { inclusions: Inclusion[] }
  if (!Array.isArray(body.inclusions)) {
    return Response.json({ error: 'inclusions must be an array' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Fetch current photo_plan so we can reconcile inclusion shots into it
  const { data: listing } = await supabase
    .from('listings')
    .select('photo_plan')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const currentPlan: PhotoShot[] = listing?.photo_plan ?? []
  const { plan: reconciledPlan, changed } = reconcileInclusionsPlan(body.inclusions, currentPlan)

  const update: Record<string, unknown> = { inclusions: body.inclusions }
  if (changed) update.photo_plan = reconciledPlan

  const { error } = await supabase
    .from('listings')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, photoPlanUpdated: changed })
}
