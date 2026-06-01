import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    listingId?: string
    gender?: string | null
    measurements?: Record<string, unknown> | null
  }
  const { listingId, gender = null, measurements = null } = body

  if (!listingId) {
    return Response.json({ error: 'listingId is required' }, { status: 400 })
  }

  await inngest.send({
    name: 'pipeline/gender-confirmed',
    data: { listingId, gender, measurements },
  })

  return Response.json({ ok: true })
}
