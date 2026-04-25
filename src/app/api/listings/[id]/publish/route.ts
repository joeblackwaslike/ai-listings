import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Listing } from '@/types/listings'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const obj = raw as Record<string, unknown>

  if (
    ('listing_url' in obj && obj.listing_url !== undefined && typeof obj.listing_url !== 'string') ||
    ('mark_published' in obj && obj.mark_published !== undefined && typeof obj.mark_published !== 'boolean') ||
    ('platform' in obj && obj.platform !== undefined && typeof obj.platform !== 'string')
  ) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const listing_url = obj.listing_url as string | undefined
  const mark_published = obj.mark_published as boolean | undefined
  const platform = obj.platform as string | undefined

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

  const supabase = getSupabaseAdmin()

  const { data: current, error: fetchError } = await supabase
    .from('listings')
    .select('listing_urls, status')
    .eq('id', id)
    .single()

  if (fetchError || !current) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  const updates: Partial<Pick<Listing, 'listing_urls' | 'status'>> = {}

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

  if (!updated) {
    return Response.json({ error: 'Update failed' }, { status: 500 })
  }

  return Response.json({ ok: true, status: updated.status, listing_urls: updated.listing_urls })
}
