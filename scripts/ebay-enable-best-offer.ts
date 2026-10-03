#!/usr/bin/env npx tsx
// Enable Best Offer on all published eBay listings by PUTting each offer
// with bestOfferTerms: { bestOfferEnabled: true } merged into the live offer body.
// --check: read-only status report using Browse API buyingOptions (GET /offer never returns bestOfferTerms)
// Usage: npx tsx --env-file=.env.local scripts/ebay-enable-best-offer.ts [--check]
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getEbayCreds } from '@/lib/platforms/credentials'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'

const USER_ID = 'c4042680-fec9-4b09-805c-86e7adb62971'

// eBay GET /offer never includes bestOfferTerms in its response; use Browse API to verify.
async function isBestOfferEnabled(listingId: string, appToken: string): Promise<boolean> {
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/v1|${listingId}|0`,
    { headers: { Authorization: `Bearer ${appToken}` } },
  )
  if (!res.ok) return false
  const data = await res.json() as { buyingOptions?: string[] }
  return Array.isArray(data.buyingOptions) && data.buyingOptions.includes('BEST_OFFER')
}

async function main() {
  const checkOnly = process.argv.includes('--check')

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
  const appToken = await (adapter as any).getApplicationToken() as string

  const results: { sku: string; ok: boolean; detail: string }[] = []

  for (const row of rows) {
    const offerId: string = row.platform_fields?.ebay?.ebay_offer_id
    const listingId: string = row.platform_fields?.ebay?.ebay_listing_id
    const sku = row.sku
    if (!offerId) continue

    try {
      if (checkOnly) {
        if (!listingId) {
          results.push({ sku, ok: false, detail: 'no listing ID in DB' })
          continue
        }
        const enabled = await isBestOfferEnabled(listingId, appToken)
        results.push({ sku, ok: enabled, detail: enabled ? 'Best Offer ON' : 'Best Offer OFF' })
        continue
      }

      // GET current offer body, merge bestOfferTerms, PUT back.
      // Strip read-only fields that eBay rejects on PUT.
      const current = await (adapter as any).ebayFetch(
        `${baseUrl}/sell/inventory/v1/offer/${offerId}`,
        { method: 'GET' },
        token,
      )
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
      results.push({ sku, ok: true, detail: 'Best Offer PUT sent' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ sku, ok: false, detail: msg.slice(0, 200) })
    }
  }

  const label = checkOnly ? 'Status' : 'Results'
  console.log(`\n=== ${label} ===`)
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.sku}: ${r.detail}`)
  if (checkOnly) {
    const on = results.filter(r => r.ok).length
    const off = results.filter(r => !r.ok).length
    console.log(`\n${on} with Best Offer ON, ${off} with Best Offer OFF`)
  } else {
    const failed = results.filter(r => !r.ok).length
    console.log(`\n${results.length - failed} PUT sent, ${failed} failed`)
    console.log('Run with --check to verify via Browse API buyingOptions.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
