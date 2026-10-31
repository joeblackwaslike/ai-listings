import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { AuthStep } from '@/types/listings'

export async function handleAuthPlan(sessionClient: SupabaseClient, supabase: SupabaseClient, id: string, req: Request) {
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { auth_plan: AuthStep[] }
  if (!Array.isArray(body.auth_plan)) {
    return Response.json({ error: 'auth_plan must be an array' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('listings')
    .update({ auth_plan: body.auth_plan })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return handleAuthPlan(await createClient(), getSupabaseAdmin(), id, req)
}
