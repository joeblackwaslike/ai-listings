import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { canConfirmCondition } from '@/lib/publish-gate'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data: current, error: loadError } = await supabase
    .from('listings')
    .select('photos_confirmed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (loadError) return Response.json({ error: loadError.message }, { status: 500 })
  if (!current) return Response.json({ error: 'Not found' }, { status: 404 })
  const gate = canConfirmCondition(current)
  if (!gate.ok) return Response.json({ error: gate.reason }, { status: 409 })

  const { data: updated, error } = await supabase
    .from('listings')
    .update({ condition_confirmed: true })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}
