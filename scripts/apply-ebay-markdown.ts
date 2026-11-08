#!/usr/bin/env bun
/**
 * Apply a 10% markdown to all published listings.
 * Pushes the new price to the live eBay listing, then mirrors it to Poshmark when the
 * listing is cross-posted, and records the new final_price_cents in the DB.
 * Pushing to eBay is required: sync-ebay-prices runs every 6h and overwrites
 * final_price_cents from eBay's live price, so a local-only update gets clobbered.
 *
 * Usage:
 *   bun scripts/apply-ebay-markdown.ts                    # dry run (default)
 *   bun scripts/apply-ebay-markdown.ts --commit           # apply changes
 *   bun scripts/apply-ebay-markdown.ts --commit --sku=X   # apply to one SKU only
 *   --poshmark-only --commit                                 # set Poshmark to floor(DB price) only
 *   --skip=A,B                                                # skip SKUs already marked down
 */

import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds, getPoshmarkCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import type { PlatformFields } from '@/types/listings'
// Import poshmark from source to avoid ESM/CJS resolution issue with @local/poshmark-seller-sdk dist
import { PoshmarkClient } from '../packages/poshmark-seller-sdk/src/index.js'

// GET /offer?listing_id= fails with 25707 for our listings (hyphenated SKUs).
// Use the stored ebay_offer_id to call GET /offer/{offerId} then PUT directly.

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'
const DISCOUNT_PCT = 10

const commit = process.argv.includes('--commit')
// Re-sync Poshmark to the DB price without touching eBay or the DB (for listings already marked down).
const poshmarkOnly = process.argv.includes('--poshmark-only')
const skipSkus = new Set(
  (process.argv.find((a) => a.startsWith('--skip='))?.slice('--skip='.length).split(',') ?? []).filter(Boolean),
)
// A listing marked down within this window is skipped, so a rerun after a crash can't cut it twice.
const RERUN_GUARD_HOURS = 24
const onlySku = process.argv.find((a) => a.startsWith('--sku='))?.slice('--sku='.length)

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

// Poshmark prices are whole dollars. updateListing can return 200 without applying the change,
// so read the price back and retry once.
async function setPoshmarkPrice(client: PoshmarkClient, id: string, priceCents: number) {
  const want = Math.floor(priceCents / 100)
  for (let attempt = 0; attempt < 2; attempt++) {
    await client.updateListing(id, { price: priceCents / 100 })
    const got = Number.parseFloat((await client.getListing(id)).price ?? '')
    if (got === want) return
  }
  throw new Error(`Poshmark price did not change to $${want}`)
}

async function main() {
  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('listings')
    .select('id, title, sku, final_price_cents, suggested_price_cents, platform_fields')
    .eq('status', 'published')
    .order('sku')
  if (onlySku) query = query.eq('sku', onlySku)

  const { data: allListings, error: listingsError } = await query

  if (listingsError) throw new Error(`Listings fetch failed: ${listingsError.message}`)
  // Filtered here, not in SQL: NOT IN drops rows with a NULL sku.
  const listings = (allListings ?? []).filter((l) => !skipSkus.has(l.sku as string))

  const recentlyMarkedDown = new Set<string>()
  if (!poshmarkOnly) {
    const since = new Date(Date.now() - RERUN_GUARD_HOURS * 3_600_000).toISOString()
    const { data: events, error: eventsError } = await supabase
      .from('listing_price_events')
      .select('listing_id')
      .ilike('note', '%markdown%')
      .gte('created_at', since)
    if (eventsError) throw new Error(`Price events fetch failed: ${eventsError.message}`)
    for (const e of events ?? []) recentlyMarkedDown.add(e.listing_id as string)
  }

  if (!listings.length) {
    console.log('No published listings found.')
    return
  }

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay credentials found for user')
  const ebay = new EbayAdapter(creds)

  const poshCreds = await getPoshmarkCreds(USER_ID)
  if (!poshCreds) {
    if (poshmarkOnly) throw new Error('No Poshmark credentials found for user')
    console.log('⚠ No Poshmark credentials — Poshmark prices will not be synced')
  }
  const poshmark = poshCreds
    ? new PoshmarkClient({ cookie: poshCreds.sessionCookies, requestDelayMs: 500 })
    : null

  console.log(`\n${commit ? '🔴 COMMIT MODE' : '🔵 DRY RUN'} — ${listings.length} listings\n`)

  let applied = 0
  let skipped = 0
  const partial: string[] = []

  for (const listing of listings) {
    const label = (listing.sku as string | null) ?? (listing.id as string)
    const currentPrice =
      (listing.final_price_cents as number | null) ??
      (listing.suggested_price_cents as number | null)

    if (!currentPrice || currentPrice <= 0) {
      console.log(`  SKIP  ${label} — no price`)
      skipped++
      continue
    }

    if (recentlyMarkedDown.has(listing.id as string)) {
      console.log(`  SKIP  ${label} — already marked down in the last ${RERUN_GUARD_HOURS}h`)
      skipped++
      continue
    }

    const newPrice = poshmarkOnly
      ? currentPrice
      : Math.round(currentPrice * (1 - DISCOUNT_PCT / 100))
    const fields = listing.platform_fields as PlatformFields
    const ebayOfferId = fields?.ebay?.ebay_offer_id
    const ebayListingId = fields?.ebay?.ebay_listing_id
    const poshmarkId = fields?.poshmark?.listing_id
    const poshmarkMin = fields?.poshmark?.min_price_cents

    console.log(
      `  ${label}  ${dollars(currentPrice)} → ${dollars(newPrice)}` +
        (ebayListingId ? `  ebay:${ebayListingId}` : '  ⚠ no ebay_listing_id') +
        (poshmarkId ? `  poshmark:${poshmarkId}` : '') +
        (poshmarkId && poshmarkMin && poshmarkMin > newPrice
          ? `  ⚠ poshmark min ${dollars(poshmarkMin)} > new price`
          : ''),
    )

    if (!commit) continue

    if (poshmarkOnly) {
      if (!poshmarkId || !poshmark) {
        skipped++
        continue
      }
      try {
        await setPoshmarkPrice(poshmark, poshmarkId, newPrice)
        applied++
      } catch (err) {
        console.error(`    ✗ poshmark failed: ${err instanceof Error ? err.message : String(err)}`)
        partial.push(`${label}: Poshmark ${poshmarkId} not updated, should be $${Math.floor(newPrice / 100)}`)
      }
      continue
    }

    if (!ebayOfferId) {
      console.log(`    ⚠ skipping — no ebay_offer_id in platform_fields`)
      skipped++
      continue
    }

    let pushAttempted = false
    try {
      // GET the full current offer to use as the base for the PUT.
      const currentOffer = await ebay.getRawOffer(ebayOfferId)
      const { listingStatus } = (currentOffer.listing as Record<string, string>) ?? {}
      if (listingStatus === 'OUT_OF_STOCK' || listingStatus === 'ENDED') {
        console.log(`    ⚠ skipping — eBay listing status: ${listingStatus}`)
        skipped++
        continue
      }

      if (!currentOffer.listingDescription) {
        // eBay's PUT /offer is a full replacement and rejects it with 25016 without a description
        console.log(`    ⚠ skipping — eBay offer has no listingDescription`)
        skipped++
        continue
      }

      // Written before the eBay push: this row is what the rerun guard reads, so it must exist
      // even if the process dies mid-listing.
      const { data: event, error: eventError } = await supabase
        .from('listing_price_events')
        .insert({
          listing_id: listing.id,
          event_type: 'manual_change',
          price_cents: newPrice,
          note: `Markdown ${DISCOUNT_PCT}% — was ${dollars(currentPrice)}, now ${dollars(newPrice)}`,
        })
        .select('id')
        .single()
      if (eventError || !event) {
        console.error(`    ✗ price event insert failed, eBay untouched: ${eventError?.message}`)
        skipped++
        continue
      }

      pushAttempted = true
      await ebay.updateOfferPrice(ebayOfferId, newPrice, currentOffer)

      let clean = true
      const { error: updateError } = await supabase
        .from('listings')
        .update({ final_price_cents: newPrice })
        .eq('id', listing.id)
      if (updateError) {
        console.error(`    ✗ DB update failed after eBay push: ${updateError.message}`)
        partial.push(
          `${label}: eBay is ${dollars(newPrice)}, DB still ${dollars(currentPrice)} — set final_price_cents=${newPrice} before running --poshmark-only`,
        )
        clean = false
      }

      let poshmarkNote = ''
      if (poshmarkId && !poshmark) {
        partial.push(`${label}: Poshmark ${poshmarkId} not updated (no credentials), should be $${Math.floor(newPrice / 100)}`)
        poshmarkNote = ' (Poshmark NOT synced)'
        clean = false
      } else if (poshmarkId && poshmark) {
        try {
          await setPoshmarkPrice(poshmark, poshmarkId, newPrice)
          poshmarkNote = ' (+ Poshmark)'
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`    ✗ poshmark failed: ${msg}`)
          partial.push(`${label}: Poshmark ${poshmarkId} not updated, should be $${Math.floor(newPrice / 100)}`)
          poshmarkNote = ' (Poshmark FAILED)'
          clean = false
        }
      }

      if (poshmarkNote) {
        await supabase
          .from('listing_price_events')
          .update({ note: `Markdown ${DISCOUNT_PCT}%${poshmarkNote} — was ${dollars(currentPrice)}, now ${dollars(newPrice)}` })
          .eq('id', event.id)
      }

      if (clean) applied++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ✗ failed: ${msg}`)
      if (pushAttempted) {
        partial.push(`${label}: eBay push errored (${msg}) — check the live eBay price; guard row kept so a rerun skips it`)
      } else {
        skipped++
      }
    }
  }

  console.log(`\nDone: ${applied} updated, ${skipped} skipped, ${partial.length} needing attention`)
  if (partial.length) {
    console.log(`Needs attention:\n  ${partial.join('\n  ')}`)
    process.exitCode = 1
  }
  if (!commit) console.log('Re-run with --commit to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
