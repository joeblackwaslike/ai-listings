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
  process.argv.find((a) => a.startsWith('--skip='))?.slice('--skip='.length).split(',') ?? [],
)
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
  if (skipSkus.size) query = query.not('sku', 'in', `(${[...skipSkus].join(',')})`)

  const { data: listings, error: listingsError } = await query

  if (listingsError) throw new Error(`Listings fetch failed: ${listingsError.message}`)
  if (!listings?.length) {
    console.log('No published listings found.')
    return
  }

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay credentials found for user')
  const ebay = new EbayAdapter(creds)

  const poshCreds = await getPoshmarkCreds(USER_ID)
  if (!poshCreds) console.log('⚠ No Poshmark credentials — Poshmark prices will not be synced')
  const poshmark = poshCreds
    ? new PoshmarkClient({ cookie: poshCreds.sessionCookies, requestDelayMs: 500 })
    : null

  console.log(`\n${commit ? '🔴 COMMIT MODE' : '🔵 DRY RUN'} — ${listings.length} listings\n`)

  let applied = 0
  let skipped = 0
  const poshmarkFailures: string[] = []
  const poshmarkUnsynced: string[] = []

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
      if (!poshmarkId || !poshmark) continue
      try {
        await setPoshmarkPrice(poshmark, poshmarkId, newPrice)
        applied++
      } catch (err) {
        console.error(`    ✗ poshmark failed: ${err instanceof Error ? err.message : String(err)}`)
        poshmarkFailures.push(`${label} (${poshmarkId})`)
      }
      continue
    }

    if (!ebayOfferId) {
      console.log(`    ⚠ skipping — no ebay_offer_id in platform_fields`)
      skipped++
      continue
    }

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

      await ebay.updateOfferPrice(ebayOfferId, newPrice, currentOffer)

      const { error: updateError } = await supabase
        .from('listings')
        .update({ final_price_cents: newPrice })
        .eq('id', listing.id)
      if (updateError) throw new Error(`DB update failed after eBay push: ${updateError.message}`)

      let poshmarkNote = ''
      if (poshmarkId && !poshmark) poshmarkUnsynced.push(`${label} → ${dollars(newPrice)} (${poshmarkId})`)
      if (poshmarkId && poshmark) {
        try {
          await setPoshmarkPrice(poshmark, poshmarkId, newPrice)
          poshmarkNote = ' (+ Poshmark)'
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`    ✗ poshmark failed: ${msg}`)
          poshmarkFailures.push(`${label} (${poshmarkId})`)
          poshmarkNote = ' (Poshmark FAILED)'
        }
      }

      await supabase.from('listing_price_events').insert({
        listing_id: listing.id,
        event_type: 'manual_change',
        price_cents: newPrice,
        note: `Markdown ${DISCOUNT_PCT}%${poshmarkNote} — was ${dollars(currentPrice)}, now ${dollars(newPrice)}`,
      })

      applied++
    } catch (err) {
      console.error(`    ✗ failed: ${err instanceof Error ? err.message : String(err)}`)
      skipped++
    }
  }

  console.log(`\nDone: ${applied} updated, ${skipped} skipped`)
  if (poshmarkFailures.length) {
    console.log(`Poshmark price sync failed for ${poshmarkFailures.length}:\n  ${poshmarkFailures.join('\n  ')}`)
  }
  if (poshmarkUnsynced.length) {
    console.log(`Poshmark price NOT updated for ${poshmarkUnsynced.length}:\n  ${poshmarkUnsynced.join('\n  ')}`)
  }
  if (!commit) console.log('Re-run with --commit to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
