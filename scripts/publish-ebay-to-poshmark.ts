#!/usr/bin/env npx tsx
/**
 * Publish all listings that are live on eBay but not yet on Poshmark.
 * Dry-run by default; pass --commit to apply.
 *
 * Usage:
 *   npx tsx scripts/publish-ebay-to-poshmark.ts
 *   npx tsx scripts/publish-ebay-to-poshmark.ts --commit
 */

import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getPoshmarkCreds } from '@/lib/platforms/credentials'
import { isPricingGateUnlocked } from '@/lib/pipeline/pricing-adjust'
import type { Listing, Photo, PlatformFields } from '@/types/listings'
// Import poshmark from source to avoid ESM/CJS resolution issue with @local/poshmark-seller-sdk dist
import { PoshmarkClient } from '../packages/poshmark-seller-sdk/src/index.js'
import { publishListingToPoshmark } from '../src/lib/platforms/publish-to-poshmark.js'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'
const commit = process.argv.includes('--commit')

// Skip: already on Poshmark, sold on eBay, or >16 photos pending manual photo review
// (retry run: only OT-0042 and HB-0123)
const SKIP_SKUS = new Set(['OT-0006', 'JW-0036', 'HB-0102', 'HB-0128', 'OT-0052', 'OT-0026', 'OT-0054',
  'OT-0050','OT-0051','OT-0055','OT-0049','JW-0038','OT-0024','HB-0105','HB-0125','OT-0044','HB-0124'])

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: listings, error } = await supabase
    .from('listings')
    .select('*')
    .eq('status', 'published')

  if (error) throw new Error(`Listings fetch failed: ${error.message}`)

  const targets = (listings ?? []).filter((l) => {
    const pf = l.platform_fields as PlatformFields
    return pf?.ebay?.ebay_listing_id && !pf?.poshmark?.listing_id && !SKIP_SKUS.has(l.sku as string)
  }) as unknown as (Listing & { user_id: string })[]

  if (!targets.length) {
    console.log('No listings found: on eBay but not Poshmark.')
    return
  }

  const listingIds = targets.map((l) => l.id)
  const { data: photoRows } = await supabase
    .from('photos')
    .select('*')
    .in('listing_id', listingIds)
    .in('type', ['studio', 'auth_card'])
    .order('display_order', { ascending: true })

  const photosByListing = new Map<string, Photo[]>()
  for (const p of (photoRows ?? []) as unknown as Photo[]) {
    const arr = photosByListing.get(p.listing_id) ?? []
    arr.push(p)
    photosByListing.set(p.listing_id, arr)
  }

  const creds = await getPoshmarkCreds(USER_ID)
  if (!creds) throw new Error('No Poshmark credentials found')
  const client = new PoshmarkClient({ cookie: creds.sessionCookies, requestDelayMs: 500 })
  // Thin publisher that implements the PoshmarkPublisher interface without importing
  // the pre-built ESM package (which breaks tsx's CJS loader).
  const adapter = {
    async createListing(listing: import('../src/lib/platforms/types.js').UnifiedListing) {
      const pf = (listing.platformFields ?? {}) as Record<string, unknown>
      const ids = pf.categoryIds as { departmentId: string; categoryId: string; subcategoryId?: string }
      return client.createListing({
        title: listing.title,
        description: listing.description ?? '',
        priceCents: listing.price,
        condition: listing.condition ?? 'ug',
        brand: listing.brand ?? '',
        sku: listing.internalId ?? '',
        imageUrls: listing.imageUrls ?? [],
        departmentId: ids.departmentId,
        categoryId: ids.categoryId,
        subcategoryId: ids.subcategoryId,
        colors: (pf.colors as string[]) ?? [],
        styleTags: (pf.styleTags as string[]) ?? [],
        size: (pf.size as string) ?? '',
        originalPriceCents: pf.originalPriceCents as number | undefined,
        minPriceCents: pf.minPriceCents as number | undefined,
        smartSell: (pf.smartSell as boolean) ?? false,
      })
    },
  }

  console.log(`\n${commit ? '🔴 COMMIT MODE' : '🔵 DRY RUN'} — ${targets.length} listings\n`)

  let ok = 0, skipped = 0, failed = 0

  for (const listing of targets) {
    const pm = (listing.platform_fields as PlatformFields)?.poshmark
    const price = listing.final_price_cents ?? listing.suggested_price_cents
    const photos = photosByListing.get(listing.id) ?? []

    const missingPmFields = ['title', 'description', 'department', 'category', 'size'].filter(
      (f) => !pm?.[f as keyof typeof pm],
    )
    if (!pm?.colors?.length) missingPmFields.push('colors')
    if (!pm?.style_tags?.length) missingPmFields.push('style_tags')

    const gateOk = isPricingGateUnlocked(listing)

    if (!gateOk || missingPmFields.length || !price || !photos.length) {
      const reasons: string[] = []
      if (!gateOk) reasons.push('pricing gate locked')
      if (missingPmFields.length) reasons.push(`missing: ${missingPmFields.join(', ')}`)
      if (!price) reasons.push('no price')
      if (!photos.length) reasons.push('no photos')
      console.log(`  SKIP  ${listing.sku}  — ${reasons.join('; ')}`)
      skipped++
      continue
    }

    console.log(
      `  ${listing.sku}  $${(price / 100).toFixed(2)}  ${photos.length} photos`,
    )

    if (!commit) continue

    try {
      const result = await publishListingToPoshmark(supabase, listing, photos, adapter, {})
      console.log(`    ✓ ${result.url ?? result.platformId}`)
      ok++
    } catch (err) {
      console.error(`    ✗ ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log(`\nDone: ${ok} published, ${skipped} skipped, ${failed} failed`)
  if (!commit) console.log('Re-run with --commit to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
