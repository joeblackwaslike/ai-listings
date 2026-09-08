#!/usr/bin/env npx tsx
// Enable Best Offer on all published eBay listings by PUTting each offer
// with bestOfferTerms: { bestOfferEnabled: true } merged into the live offer body.
// Usage: npx tsx --env-file=.env.local scripts/ebay-enable-best-offer.ts
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'

async function main() {
  const supabase = getSupabaseAdmin()
  const { data: rows } = await supabase
    .from('listings')
    .select('sku, platform_fields')
    .eq('status', 'published')
    .not('platform_fields->ebay->ebay_offer_id', 'is', null)

  if (!rows?.length) { console.log('No published listings with offer IDs.'); return }

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay creds')
  const adapter = new EbayAdapter(creds)
  const token = await (adapter as any).getAccessToken() as string
  const baseUrl = (adapter as any).baseUrl as string

  const results: { sku: string; ok: boolean; detail: string }[] = []

  for (const row of rows) {
    const offerId: string = row.platform_fields?.ebay?.ebay_offer_id
    const sku = row.sku
    if (!offerId) continue

    try {
      // GET current offer body
      const current = await (adapter as any).ebayFetch(
        `${baseUrl}/sell/inventory/v1/offer/${offerId}`,
        { method: 'GET' },
        token,
      )

      // Merge bestOfferTerms into the live offer body.
      // Strip read-only fields that eBay rejects on PUT.
      const { offerId: _id, listing, ...putBody } = current
      const body = {
        ...putBody,
        bestOfferTerms: { bestOfferEnabled: true },
      }

      await (adapter as any).ebayFetch(
        `${baseUrl}/sell/inventory/v1/offer/${offerId}`,
        { method: 'PUT', body: JSON.stringify(body) },
        token,
      )
      results.push({ sku, ok: true, detail: 'Best Offer enabled' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ sku, ok: false, detail: msg.slice(0, 200) })
    }
  }

  console.log('\n=== Results ===')
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.sku}: ${r.detail}`)
  console.log(`\n${results.filter(r => r.ok).length} updated, ${results.filter(r => !r.ok).length} failed`)
}

main().catch(err => { console.error(err); process.exit(1) })
