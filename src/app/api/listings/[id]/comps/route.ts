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
  // EvidenceDrawer renders comp.listing_url verbatim as an <a href> for every comp,
  // including manual ones -- an unvalidated scheme (javascript:, data:, etc.) stored here
  // would render as a clickable link that executes on click. Only http(s) is a real
  // listing URL anyway.
  const trimmedUrl = body.listingUrl?.trim() || null
  if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
    return NextResponse.json({ error: 'listingUrl must start with http:// or https://' }, { status: 400 })
  }

  const isActive = body.isActive === true
  const salePriceCents = Math.round(body.salePriceCents)

  // pricing_comps carries its own owner-scoped RLS policy (`owner_access`, migration 0002:
  // listing_id IN (SELECT id FROM listings WHERE user_id = auth.uid())) -- verified live
  // against production, not just migration 0001's now-superseded authenticated_full_access.
  // The listing lookup above is a defense-in-depth 404 for a nonexistent/foreign listing_id,
  // not the only thing preventing a cross-user insert.
  const { error: insertError } = await supabase.from('pricing_comps').insert({
    listing_id: listingId,
    source: isActive ? 'manual_active' : 'manual',
    provider: 'manual',
    title: body.title.trim(),
    sale_price_cents: salePriceCents,
    condition: 'Not specified',
    sold_at: isActive ? null : (body.soldAt ?? null),
    listing_url: trimmedUrl,
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

  // The comp is already durably saved at this point -- a recalculation failure here must
  // not report the whole request as failed (the client re-shows the add form and retries on
  // any non-OK response, which would insert a second, duplicate comp). Report the comp as
  // added regardless; recalculated:false tells the client the displayed price may be stale
  // until the next successful recalc (e.g. deleting and re-adding, or the next automated run).
  try {
    const result = await recalculateListingPrice(listingId)
    return NextResponse.json({ ok: true, recalculated: true, ...result })
  } catch (err) {
    console.error(`comps route: recalculateListingPrice failed after successful insert for listing ${listingId}`, err)
    return NextResponse.json({ ok: true, recalculated: false })
  }
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
  if (!body.compId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.compId)) {
    return NextResponse.json({ error: 'compId must be a valid UUID' }, { status: 400 })
  }

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

  // Same reasoning as POST above: the delete already committed, so a recalculation failure
  // here must not read back as "the comp wasn't removed."
  try {
    const result = await recalculateListingPrice(listingId)
    return NextResponse.json({ ok: true, recalculated: true, ...result })
  } catch (err) {
    console.error(`comps route: recalculateListingPrice failed after successful delete for listing ${listingId}`, err)
    return NextResponse.json({ ok: true, recalculated: false })
  }
}
