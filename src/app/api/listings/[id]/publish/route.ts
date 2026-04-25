import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { platform?: string; listing_url?: string; mark_published?: boolean }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { platform, listing_url, mark_published } = body

  if (!listing_url && !mark_published) {
    return Response.json({ error: 'No action specified' }, { status: 400 })
  }

  if (listing_url && !platform) {
    return Response.json({ error: 'platform required when listing_url is provided' }, { status: 400 })
  }

  if (platform && platform !== 'ebay' && platform !== 'poshmark') {
    return Response.json({ error: 'platform must be ebay or poshmark' }, { status: 400 })
  }

  if (listing_url) {
    try {
      new URL(listing_url)
    } catch {
      return Response.json({ error: 'listing_url must be a valid URL' }, { status: 400 })
    }
  }

  const supabase = getAdmin()

  const { data: current, error: fetchError } = await supabase
    .from('listings')
    .select('listing_urls, status')
    .eq('id', id)
    .single()

  if (fetchError || !current) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}

  if (listing_url && platform) {
    const existing = (current.listing_urls as Record<string, string> | null) ?? {}
    updates.listing_urls = { ...existing, [platform]: listing_url }
  }

  if (mark_published) {
    updates.status = 'published'
  }

  const { data: updated, error: updateError } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', id)
    .select('status, listing_urls')
    .single()

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 })
  }

  return Response.json({ ok: true, status: updated.status, listing_urls: updated.listing_urls })
}
