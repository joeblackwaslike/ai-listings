import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { buildUnifiedListingForEbay } from '@/lib/platforms/unified-listing'
import { mapPostToEbayError } from '@/lib/platforms/post-to-ebay-error'
import type { Listing, Photo, PlatformFields, ListingUrls } from '@/types/listings'

export async function POST(
  _req: Request,
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

  // Explicit ownership check — publish/route.ts (the existing manual-URL-paste route) does not
  // do this today, which is a real pre-existing gap; this new route must not repeat it.
  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!listing.platform_fields?.ebay) {
    return Response.json(
      { error: 'No eBay fields generated yet — run the pipeline through step 4 first' },
      { status: 400 }
    )
  }

  if (!listing.sku) {
    return Response.json({ error: 'Listing has no SKU assigned yet' }, { status: 400 })
  }

  const creds = await getEbayCreds(user.id)
  if (!creds) {
    return Response.json(
      { error: 'eBay not connected — add your App ID, Cert ID, RuName and connect via OAuth in Settings → Platforms' },
      { status: 400 }
    )
  }

  const missingPolicyFields: string[] = []
  if (!creds.fulfillmentPolicyId) missingPolicyFields.push('fulfillment policy ID')
  if (!creds.paymentPolicyId) missingPolicyFields.push('payment policy ID')
  if (!creds.returnPolicyId) missingPolicyFields.push('return policy ID')
  if (!creds.merchantLocationKey) missingPolicyFields.push('merchant location key')

  if (missingPolicyFields.length > 0) {
    return Response.json(
      {
        error: `eBay is connected, but Business Policies settings are missing: ${missingPolicyFields.join(', ')}. Set these in Settings → Platforms after completing Business Policies setup in eBay Seller Hub.`,
      },
      { status: 400 }
    )
  }

  const { data: photoRows } = await supabase
    .from('photos')
    .select('*')
    .eq('listing_id', id)
    .order('display_order', { ascending: true })
  const photos = (photoRows ?? []) as unknown as Photo[]

  try {
    const unifiedListing = await buildUnifiedListingForEbay(listing, photos)
    const result = await new EbayAdapter(creds).createListing(unifiedListing)

    const currentPlatformFields = listing.platform_fields as PlatformFields
    const updatedPlatformFields: PlatformFields = {
      ...currentPlatformFields,
      ebay: {
        ...currentPlatformFields.ebay!,
        ebay_listing_id: result.platformId,
        ebay_offer_id: result.offerId,
      },
    }
    const updatedListingUrls: ListingUrls = { ...(listing.listing_urls ?? {}), ebay: result.url }

    const { error: updateError } = await supabase
      .from('listings')
      .update({
        listing_urls: updatedListingUrls,
        status: 'published',
        platform_fields: updatedPlatformFields,
      })
      .eq('id', id)

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    return Response.json({
      ok: true,
      platformId: result.platformId,
      offerId: result.offerId,
      url: result.url,
    })
  } catch (err) {
    const mapped = mapPostToEbayError(err)
    if (mapped.status === 500) console.error('post-to-ebay failed:', err)
    return Response.json({ error: mapped.error }, { status: mapped.status })
  }
}
