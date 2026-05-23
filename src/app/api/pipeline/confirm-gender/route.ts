import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { listingId?: string; gender?: string; size?: string | null }
  const { listingId, gender, size = null } = body

  if (!listingId || !gender) {
    return Response.json({ error: 'listingId and gender are required' }, { status: 400 })
  }

  await inngest.send({
    name: 'pipeline/gender-confirmed',
    data: { listingId, gender, size: size ?? null },
  })

  return Response.json({ ok: true })
}
