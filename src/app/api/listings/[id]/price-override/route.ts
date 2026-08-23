import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// final_price_cents already wins over every computed price everywhere it's consumed
// (publish, eBay listing build, agent tools, auto-discount cron) -- this route is just
// the missing UI-facing write path for it. A null body clears the override, falling
// back to the normal computed price.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { finalPriceCents?: number | null }
  if (body.finalPriceCents !== null) {
    if (typeof body.finalPriceCents !== 'number' || !Number.isFinite(body.finalPriceCents) || body.finalPriceCents <= 0) {
      return NextResponse.json({ error: 'finalPriceCents must be a positive number or null' }, { status: 400 })
    }
  }

  // RLS (owner_access on listings) scopes this to the caller's own rows -- a non-owner's
  // request matches zero rows and updated stays null.
  const { data: updated, error } = await supabase
    .from('listings')
    .update({ final_price_cents: body.finalPriceCents === null ? null : Math.round(body.finalPriceCents) })
    .eq('id', listingId)
    .select('id, final_price_cents')
    .maybeSingle()

  if (error) return NextResponse.json({ error: `Failed to update price: ${error.message}` }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  return NextResponse.json({ ok: true, final_price_cents: updated.final_price_cents })
}
