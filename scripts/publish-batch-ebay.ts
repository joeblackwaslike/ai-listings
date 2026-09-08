#!/usr/bin/env npx tsx
/**
 * Batch-publish all in_loop eBay-ready listings.
 * Usage: npx tsx scripts/publish-batch-ebay.ts
 */
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { publishListingToEbay } from '@/lib/platforms/publish-to-ebay'
import { isPricingGateUnlocked } from '@/lib/pipeline/pricing-adjust'
import type { Listing, Photo, PricingComp } from '@/types/listings'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'

async function main() {
  const supabase = getSupabaseAdmin()

  // Fetch all in_loop listings with eBay fields ready
  const { data: rows, error } = await supabase
    .from('listings')
    .select('*')
    .in('sku', ['HB-0124', 'OT-0050'])
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`DB fetch failed: ${error.message}`)
  if (!rows?.length) { console.log('No eligible listings found.'); return }

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay credentials found for user')

  const results: { sku: string; ok: boolean; detail: string }[] = []

  for (const row of rows) {
    const listing = row as unknown as Listing & { user_id: string | null }
    const sku = listing.sku!

    if (!isPricingGateUnlocked(listing)) {
      results.push({ sku, ok: false, detail: 'pricing gate locked (unconfirmed condition/inclusions)' })
      continue
    }

    const [{ data: photoRows }, { data: compRows }] = await Promise.all([
      supabase.from('photos').select('*').eq('listing_id', listing.id).order('display_order', { ascending: true }),
      supabase.from('pricing_comps').select('*').eq('listing_id', listing.id),
    ])

    const photos = (photoRows ?? []) as unknown as Photo[]
    const comps = (compRows ?? []) as unknown as PricingComp[]

    try {
      const result = await publishListingToEbay(supabase, listing, photos, comps, new EbayAdapter(creds), { draft: false })
      results.push({ sku, ok: true, detail: result.url ?? result.platformId ?? 'published' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ sku, ok: false, detail: msg })
    }
  }

  console.log('\n=== Results ===')
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗'
    console.log(`${icon} ${r.sku}: ${r.detail}`)
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${passed} published, ${failed} failed`)
}

main().catch(err => { console.error(err); process.exit(1) })
