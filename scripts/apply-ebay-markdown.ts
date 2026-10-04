#!/usr/bin/env npx tsx
/**
 * Apply a 10% markdown to all eBay listings live for 7+ days.
 * Updates final_price_cents in DB and pushes the new price to the live eBay listing.
 * Pushing to eBay is required: sync-ebay-prices runs every 6h and overwrites
 * final_price_cents from eBay's live price, so a local-only update gets clobbered.
 *
 * Usage:
 *   npx tsx scripts/apply-ebay-markdown.ts           # dry run (default)
 *   npx tsx scripts/apply-ebay-markdown.ts --commit  # apply changes
 */

import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import type { PlatformFields } from '@/types/listings'

// GET /offer?listing_id= fails with 25707 for our listings (hyphenated SKUs).
// Use the stored ebay_offer_id to call GET /offer/{offerId} then PUT directly.

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'
const DISCOUNT_PCT = 10
const MIN_DAYS_LISTED = 7

const commit = process.argv.includes('--commit')

async function main() {
  const supabase = getSupabaseAdmin()

  // Find the most recent eBay publish date per listing (ordered desc, first hit wins)
  const { data: events, error: eventsError } = await supabase
    .from('platform_price_events')
    .select('listing_id, recorded_at')
    .eq('platform', 'ebay')
    .eq('event_type', 'published')
    .order('recorded_at', { ascending: false })

  if (eventsError) throw new Error(`Events fetch failed: ${eventsError.message}`)

  const cutoff = new Date(Date.now() - MIN_DAYS_LISTED * 24 * 60 * 60 * 1000)

  // Most recent publish date per listing (events are already newest-first)
  const latestPublish = new Map<string, Date>()
  for (const e of events ?? []) {
    const id = e.listing_id as string
    if (!latestPublish.has(id)) {
      latestPublish.set(id, new Date(e.recorded_at as string))
    }
  }

  const eligibleIds = [...latestPublish.entries()]
    .filter(([, date]) => date < cutoff)
    .map(([id]) => id)

  if (!eligibleIds.length) {
    console.log('No eBay listings have been live for 7+ days.')
    return
  }

  const { data: listings, error: listingsError } = await supabase
    .from('listings')
    .select('id, title, sku, final_price_cents, suggested_price_cents, platform_fields')
    .in('id', eligibleIds)
    .eq('status', 'published')

  if (listingsError) throw new Error(`Listings fetch failed: ${listingsError.message}`)
  if (!listings?.length) {
    console.log('No published listings found in eligible set.')
    return
  }

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay credentials found for user')
  const ebay = new EbayAdapter(creds)

  console.log(`\n${commit ? '🔴 COMMIT MODE' : '🔵 DRY RUN'} — ${listings.length} listings\n`)

  let applied = 0
  let skipped = 0

  for (const listing of listings) {
    const currentPrice =
      (listing.final_price_cents as number | null) ??
      (listing.suggested_price_cents as number | null)

    if (!currentPrice || currentPrice <= 0) {
      console.log(`  SKIP  ${listing.sku ?? listing.id} — no price`)
      skipped++
      continue
    }

    const newPrice = Math.round(currentPrice * (1 - DISCOUNT_PCT / 100))
    const ebayFields = (listing.platform_fields as PlatformFields)?.ebay
    const ebayOfferId = ebayFields?.ebay_offer_id
    const ebayListingId = ebayFields?.ebay_listing_id
    const daysListed = Math.floor(
      (Date.now() - (latestPublish.get(listing.id as string) ?? new Date()).getTime()) /
        (1000 * 60 * 60 * 24),
    )

    console.log(
      `  ${listing.sku ?? listing.id}` +
        `  $${(currentPrice / 100).toFixed(2)} → $${(newPrice / 100).toFixed(2)}` +
        `  (${daysListed}d)` +
        (ebayListingId ? `  ebay:${ebayListingId}` : '  ⚠ no ebay_listing_id'),
    )

    if (!commit) continue

    if (!ebayOfferId) {
      console.log(`    ⚠ skipping eBay push — no ebay_offer_id in platform_fields`)
      skipped++
      continue
    }

    try {
      // GET the full current offer to use as the base for the PUT.
      // GET /offer?listing_id= fails with 25707 for hyphenated SKUs — use offerId directly.
      const currentOffer = await ebay.getRawOffer(ebayOfferId)
      const { listingStatus } = (currentOffer.listing as Record<string, string>) ?? {}
      if (listingStatus === 'OUT_OF_STOCK' || listingStatus === 'ENDED') {
        console.log(`    ⚠ skipping — eBay listing status: ${listingStatus}`)
        skipped++
        continue
      }

      await supabase
        .from('listings')
        .update({ final_price_cents: newPrice })
        .eq('id', listing.id)

      await ebay.updateOfferPrice(ebayOfferId, newPrice, currentOffer)

      await supabase.from('listing_price_events').insert({
        listing_id: listing.id,
        event_type: 'manual_change',
        price_cents: newPrice,
        note: `eBay markdown ${DISCOUNT_PCT}% — was $${(currentPrice / 100).toFixed(2)}, now $${(newPrice / 100).toFixed(2)}`,
      })

      applied++
    } catch (err) {
      console.error(`    ✗ failed: ${err instanceof Error ? err.message : String(err)}`)
      skipped++
    }
  }

  console.log(`\nDone: ${applied} updated, ${skipped} skipped`)
  if (!commit) console.log('Re-run with --commit to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
