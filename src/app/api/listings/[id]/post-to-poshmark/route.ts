import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getPoshmarkCreds } from '@/lib/platforms/credentials'
import { PoshmarkAdapter } from '@/lib/platforms/adapters/poshmark'
import { publishListingToPoshmark } from '@/lib/platforms/publish-to-poshmark'
import { isPricingGateUnlocked } from '@/lib/pipeline/pricing-adjust'
import { PoshmarkCreatePendingError, PlatformError } from '@/lib/platforms/errors'
import type { Listing, Photo } from '@/types/listings'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()

  const { data: listingRow, error: fetchError } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !listingRow) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  const listing = listingRow as unknown as Listing & { user_id: string | null }

  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isPricingGateUnlocked(listing)) {
    return Response.json(
      { error: 'Confirm condition and all inclusions before publishing.' },
      { status: 400 }
    )
  }

  const pm = listing.platform_fields?.poshmark
  if (!pm) {
    return Response.json(
      { error: 'No Poshmark fields generated yet — run the pipeline through step 4 first' },
      { status: 400 }
    )
  }

  const missingFields: string[] = []
  if (!pm.title) missingFields.push('title')
  if (!pm.description) missingFields.push('description')
  if (!pm.department) missingFields.push('department')
  if (!pm.category) missingFields.push('category')
  if (!pm.size) missingFields.push('size')
  if (!pm.colors?.length) missingFields.push('colors')
  if (!pm.style_tags?.length) missingFields.push('style_tags')
  if (missingFields.length > 0) {
    return Response.json(
      { error: `Poshmark fields incomplete: ${missingFields.join(', ')}. Re-run step 4 to regenerate.` },
      { status: 400 }
    )
  }

  if (!listing.sku) {
    return Response.json({ error: 'Listing has no SKU assigned yet' }, { status: 400 })
  }

  const creds = await getPoshmarkCreds(user.id)
  if (!creds) {
    return Response.json(
      { error: 'Poshmark not connected — add your session cookies in Settings → Platforms' },
      { status: 400 }
    )
  }

  let body: { photo_ids?: string[]; draft?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw
  } catch {
    // empty or invalid body is fine
  }
  const draft = body.draft ?? false

  const { data: photoRows } = await supabase
    .from('photos')
    .select('*')
    .eq('listing_id', id)
    .in('type', ['studio', 'auth_card'])
    .order('display_order', { ascending: true })

  const photos = (photoRows ?? []) as unknown as Photo[]

  try {
    const result = await publishListingToPoshmark(
      supabase,
      listing,
      photos,
      new PoshmarkAdapter(creds),
      { draft, photoIds: body.photo_ids }
    )

    return Response.json({
      ok: true,
      draft,
      platformId: result.platformId || undefined,
      url: result.url || undefined,
    })
  } catch (err) {
    if (err instanceof PoshmarkCreatePendingError) {
      return Response.json(
        { ok: false, error: 'poshmark_create_pending', message: 'Poshmark publishing is not yet available — the create listing endpoint is pending reverse-engineering.' },
        { status: 501 }
      )
    }
    if (err instanceof PlatformError) {
      return Response.json({ error: err.message }, { status: 422 })
    }
    console.error('[post-to-poshmark]', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 })
  }
}
