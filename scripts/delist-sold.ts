#!/usr/bin/env bun
/**
 * Delist sold listings from every other platform they are still published on.
 * Dry-run by default; pass --commit to apply.
 *
 * Usage:
 *   bun run scripts/delist-sold.ts --sold-on=poshmark HB-0125
 *   bun run scripts/delist-sold.ts --sold-on=ebay OT-0026 OT-0042 OT-0024 --commit
 */

import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds, getPoshmarkCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import type { ListingUrls, PlatformFields } from '@/types/listings'
// Import from source: the built ESM package breaks the script loader (see publish-ebay-to-poshmark.ts)
import { PoshmarkClient } from '../packages/poshmark-seller-sdk/src/index.js'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'
const commit = process.argv.includes('--commit')
const soldOn = process.argv.find((a) => a.startsWith('--sold-on='))?.split('=')[1]
const skus = process.argv.slice(2).filter((a) => !a.startsWith('--'))

async function main() {
  if (!skus.length) throw new Error('Pass at least one SKU')
  if (soldOn !== 'ebay' && soldOn !== 'poshmark') throw new Error('Pass --sold-on=ebay|poshmark')

  const supabase = getSupabaseAdmin()
  const ebayCreds = await getEbayCreds(USER_ID)
  const poshCreds = await getPoshmarkCreds(USER_ID)
  if (!ebayCreds || !poshCreds) throw new Error('Missing eBay or Poshmark credentials')
  const ebay = new EbayAdapter(ebayCreds)
  const posh = new PoshmarkClient({ cookie: poshCreds.sessionCookies, requestDelayMs: 500 })

  const { data, error } = await supabase
    .from('listings')
    .select('id, sku, status, sold_at, listing_urls, platform_fields')
    .in('sku', skus)
  if (error) throw new Error(`Listings fetch failed: ${error.message}`)

  const failed: string[] = []
  for (const sku of skus) {
    const l = data?.find((r) => r.sku === sku)
    if (!l) {
      console.log(`${sku}: not found`)
      failed.push(sku)
      continue
    }
    try {
      const pf = l.platform_fields as PlatformFields
      const urls = { ...((l.listing_urls ?? {}) as ListingUrls) }
      const targets = (['ebay', 'poshmark'] as const).filter((p) => p !== soldOn && urls[p])
      console.log(`${sku}: status=${l.status} delist=[${targets}] -> ${commit ? 'applying' : 'dry-run'}`)
      if (!commit) continue

      for (const p of targets) {
        if (p === 'ebay') {
          const offerId = pf?.ebay?.ebay_offer_id
          if (!offerId) throw new Error('no ebay_offer_id')
          await ebay.withdrawOffer(offerId)
        } else {
          const id = pf?.poshmark?.listing_id
          if (!id) throw new Error('no poshmark listing_id')
          await posh.deleteListing(id)
        }
        delete urls[p]
        const { error: urlErr } = await supabase.from('listings').update({ listing_urls: urls }).eq('id', l.id)
        if (urlErr) throw new Error(`${p} delisted but listing_urls update failed: ${urlErr.message}`)
        console.log(`${sku}: ${p} delisted`)
      }

      const { error: upErr } = await supabase
        .from('listings')
        .update({ status: 'sold', sold_at: l.sold_at ?? new Date().toISOString() })
        .eq('id', l.id)
      if (upErr) throw new Error(`update failed: ${upErr.message}`)
      console.log(`${sku}: db updated`)
    } catch (e) {
      console.error(`${sku}: FAILED: ${e instanceof Error ? e.message : e}`)
      failed.push(sku)
    }
  }

  if (failed.length) {
    console.error(`Failed SKUs: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
