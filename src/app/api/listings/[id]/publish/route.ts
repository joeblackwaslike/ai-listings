import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { Listing } from '@/types/listings'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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
    .select('listing_urls, status, user_id, platform_fields')
    .eq('id', id)
    .single()

  if (fetchError || !current) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  // Title length validation — warn but do not block
  let titleWarning: { warning: string; currentLength: number; maxLength: number } | null = null
  if (platform && current.user_id) {
    const TITLE_LIMITS: Record<string, number> = { ebay: 80, poshmark: 60 }
    const maxLength = TITLE_LIMITS[platform]
    if (maxLength) {
      const platformFields = current.platform_fields as Record<string, Record<string, string>> | null
      const title: string | undefined = platformFields?.[platform]?.title
      if (title && title.length > maxLength) {
        titleWarning = { warning: 'title_too_long', currentLength: title.length, maxLength }
      }
    }
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

  return Response.json({
    ok: true,
    status: updated.status,
    listing_urls: updated.listing_urls,
    ...(titleWarning ?? {}),
  })
}
