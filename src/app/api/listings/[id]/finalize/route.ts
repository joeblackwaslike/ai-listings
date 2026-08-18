import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { isPricingGateUnlocked } from '@/lib/pipeline/pricing-adjust'
import type { Inclusion } from '@/types/listings'

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: listing } = await supabase
    .from('listings')
    .select('user_id, condition_confirmed, inclusions')
    .eq('id', id)
    .single()
  if (!listing || listing.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Real pricing gate (ai-listings-yva): pricing (comp premiums + authenticity premium) only
  // reflects condition + inclusions once both are confirmed -- see computeAdjustedPricing in
  // pricing-adjust.ts. Finalizing before either is confirmed would lock in a price that hasn't
  // accounted for them.
  const inclusions = (listing.inclusions ?? []) as unknown as Inclusion[]
  if (!isPricingGateUnlocked({ condition_confirmed: listing.condition_confirmed, inclusions })) {
    return Response.json(
      { error: 'Confirm condition and all inclusions before finalizing.' },
      { status: 400 }
    )
  }

  // Only a listing actively in the loop can be finalized -- this no-ops (still 200) if it's
  // already finalizing/published/archived, matching this codebase's other status-setting
  // routes (see archive/route.ts).
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ status: 'finalizing' })
    .eq('id', id)
    .eq('status', 'in_loop')
    .select('status')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, status: updated?.status ?? 'unchanged' })
}
