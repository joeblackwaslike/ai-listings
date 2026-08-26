import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'
import { generatePhotoPlan } from '@/lib/pipeline/generate-photo-plan'
import type { ListingCategory, Inclusion } from '@/types/listings'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data: listing, error: fetchErr } = await supabase
    .from('listings')
    .select('brand, category, intake_meta, inclusions, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !listing) return Response.json({ error: 'Listing not found' }, { status: 404 })

  const apiKeys = await getUserApiKeys(user.id)
  if (!apiKeys.anthropic) return Response.json({ error: 'Anthropic API key not configured' }, { status: 400 })

  const intakeMeta = listing.intake_meta as { visionAnalysis?: { notable_features?: string[] } } | null
  const notableFeatures = intakeMeta?.visionAnalysis?.notable_features ?? []

  const photoPlan = await generatePhotoPlan({
    category: listing.category as ListingCategory,
    brand: listing.brand ?? '',
    notableFeatures,
    inclusions: (listing.inclusions as Inclusion[]) ?? [],
    anthropicKey: apiKeys.anthropic,
  })

  const { error: updateErr } = await supabase
    .from('listings')
    .update({
      photo_plan: photoPlan,
      photo_plan_generated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })
  return Response.json({ ok: true, photo_plan: photoPlan })
}
