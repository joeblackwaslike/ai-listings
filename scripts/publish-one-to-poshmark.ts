#!/usr/bin/env npx tsx
/**
 * Publish a single listing to Poshmark with an explicit photo selection.
 *
 * Usage:
 *   npx tsx scripts/publish-one-to-poshmark.ts --sku HB-0128
 *   npx tsx scripts/publish-one-to-poshmark.ts --sku HB-0128 --photos "id1,id2,..." --commit
 *
 * --photos   comma-separated photo UUIDs in desired display order (max 16)
 *            omit to use default selection (first 16 by display_order)
 * --commit   apply; dry-run by default
 */

import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getPoshmarkCreds } from '@/lib/platforms/credentials'
import type { Listing, Photo, PlatformFields } from '@/types/listings'
import { PoshmarkClient } from '../packages/poshmark-seller-sdk/src/index.js'
import { publishListingToPoshmark } from '../src/lib/platforms/publish-to-poshmark.js'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'

const argv = process.argv.slice(2)
const get = (flag: string) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : undefined }

const SKU = get('--sku')
const photoIdsRaw = get('--photos')
const commit = argv.includes('--commit')

if (!SKU) {
  console.error('Usage: publish-one-to-poshmark.ts --sku SKU [--photos "id1,id2,..."] [--commit]')
  process.exit(1)
}

const photoIds = photoIdsRaw ? photoIdsRaw.split(',').filter(Boolean) : undefined

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: listingRow, error } = await supabase
    .from('listings')
    .select('*')
    .eq('sku', SKU)
    .single()

  if (error || !listingRow) {
    console.error(`${SKU} not found: ${error?.message ?? 'no row'}`)
    process.exit(1)
  }

  const listing = listingRow as unknown as Listing
  const pf = listing.platform_fields as PlatformFields

  if (pf?.poshmark?.listing_id) {
    console.error(`${SKU} already has poshmark listing_id: ${pf.poshmark.listing_id}`)
    process.exit(1)
  }

  const { data: photoRows } = await supabase
    .from('photos')
    .select('*')
    .eq('listing_id', listing.id)
    .in('type', ['studio', 'auth_card'])
    .order('display_order', { ascending: true })

  const photos = (photoRows ?? []) as unknown as Photo[]

  if (photoIds) {
    const ids = new Set(photos.map((p) => p.id))
    const invalid = photoIds.filter((id) => !ids.has(id))
    if (invalid.length) { console.error(`Unknown photo IDs: ${invalid.join(', ')}`); process.exit(1) }
    if (photoIds.length > 16) { console.error(`Too many photos: ${photoIds.length} (max 16)`); process.exit(1) }
  }

  const creds = await getPoshmarkCreds(USER_ID)
  if (!creds) throw new Error('No Poshmark credentials found')
  const client = new PoshmarkClient({ cookie: creds.sessionCookies, requestDelayMs: 500 })

  const adapter = {
    async createListing(l: import('../src/lib/platforms/types.js').UnifiedListing) {
      const lpf = (l.platformFields ?? {}) as Record<string, unknown>
      const ids = lpf.categoryIds as { departmentId: string; categoryId: string; subcategoryId?: string }
      return client.createListing({
        title: l.title,
        description: l.description ?? '',
        priceCents: l.price,
        condition: l.condition ?? 'ug',
        brand: l.brand ?? '',
        sku: l.internalId ?? '',
        imageUrls: l.imageUrls ?? [],
        departmentId: ids.departmentId,
        categoryId: ids.categoryId,
        subcategoryId: ids.subcategoryId,
        colors: (lpf.colors as string[]) ?? [],
        styleTags: (lpf.styleTags as string[]) ?? [],
        size: (lpf.size as string) ?? '',
        originalPriceCents: lpf.originalPriceCents as number | undefined,
        minPriceCents: lpf.minPriceCents as number | undefined,
        smartSell: (lpf.smartSell as boolean) ?? false,
      })
    },
  }

  const price = listing.final_price_cents ?? listing.suggested_price_cents
  const selected = photoIds ? photos.filter((p) => photoIds.includes(p.id)) : photos.slice(0, 16)

  console.log(`\n${commit ? 'COMMIT MODE' : 'DRY RUN'} — ${SKU}`)
  console.log(`  Price:  $${((price ?? 0) / 100).toFixed(2)}`)
  console.log(`  Photos: ${selected.length}`)
  selected.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2)}. [${p.type}] order=${p.display_order}  ${p.id}`))

  if (!commit) { console.log('\nRe-run with --commit to publish.'); return }

  const result = await publishListingToPoshmark(supabase, listing, photos, adapter, { photoIds })
  console.log(`\n✓ Published: ${result.url ?? result.platformId}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
