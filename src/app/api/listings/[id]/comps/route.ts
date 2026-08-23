import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recalculateListingPrice } from '@/lib/pipeline/step3-pricing-research'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS (owner_access on listings) scopes this to the caller's own rows -- a
  // non-owner's request matches zero rows and listing stays null, same pattern
  // confirm-id's route uses.
  const { data: listing } = await supabase
    .from('listings')
    .select('id')
    .eq('id', listingId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const body = (await request.json()) as {
    title?: string
    salePriceCents?: number
    listingUrl?: string | null
    soldAt?: string | null
    isActive?: boolean
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (typeof body.salePriceCents !== 'number' || !Number.isFinite(body.salePriceCents) || body.salePriceCents <= 0) {
    return NextResponse.json({ error: 'salePriceCents must be a positive number' }, { status: 400 })
  }

  const isActive = body.isActive === true
  const salePriceCents = Math.round(body.salePriceCents)

  // pricing_comps has no owner-scoped RLS policy (authenticated_full_access is open to any
  // signed-in user), unlike listings -- the ownership check above is what actually gates
  // this insert to the caller's own listing.
  const { error: insertError } = await supabase.from('pricing_comps').insert({
    listing_id: listingId,
    source: isActive ? 'manual_active' : 'manual',
    provider: 'manual',
    title: body.title.trim(),
    sale_price_cents: salePriceCents,
    condition: 'Not specified',
    sold_at: isActive ? null : (body.soldAt ?? null),
    listing_url: body.listingUrl?.trim() || null,
    condition_delta: 'same',
    // A hand-entered comp is a direct real-world observation, not a comparable that needs
    // the automated condition-normalization adjustment applied to fetched comps.
    adjusted_price_cents: salePriceCents,
    relevance_score: null,
    color: null,
  })
  if (insertError) {
    return NextResponse.json({ error: `Failed to add comp: ${insertError.message}` }, { status: 500 })
  }

  const result = await recalculateListingPrice(listingId)
  return NextResponse.json({ ok: true, ...result })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: listing } = await supabase
    .from('listings')
    .select('id')
    .eq('id', listingId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const body = (await request.json()) as { compId?: string }
  if (!body.compId) return NextResponse.json({ error: 'compId is required' }, { status: 400 })

  // Restrict the delete to this listing's own manual rows -- never lets the caller delete
  // an automated comp (those get regenerated/removed by the pipeline itself) or a comp
  // belonging to a different listing_id via a mismatched compId.
  const { error: deleteError } = await supabase
    .from('pricing_comps')
    .delete()
    .eq('id', body.compId)
    .eq('listing_id', listingId)
    .in('source', ['manual', 'manual_active'])
  if (deleteError) {
    return NextResponse.json({ error: `Failed to remove comp: ${deleteError.message}` }, { status: 500 })
  }

  const result = await recalculateListingPrice(listingId)
  return NextResponse.json({ ok: true, ...result })
}
