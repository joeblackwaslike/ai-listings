#!/usr/bin/env npx tsx
// Fetch one live eBay offer and log bestOfferTerms to diagnose Allow Offers state.
// Usage: npx tsx --env-file=.env.local scripts/ebay-offer-check.ts
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
    .limit(3)

  const creds = await getEbayCreds(USER_ID)
  if (!creds) throw new Error('No eBay creds')
  const adapter = new EbayAdapter(creds)
  const token = await (adapter as any).getAccessToken()
  const baseUrl = (adapter as any).baseUrl

  for (const row of rows ?? []) {
    const offerId = row.platform_fields?.ebay?.ebay_offer_id
    if (!offerId) continue
    const res = await (adapter as any).ebayFetch(
      `${baseUrl}/sell/inventory/v1/offer/${offerId}`,
      { method: 'GET' },
      token,
    )
    console.log(`\n=== ${row.sku} (offer ${offerId}) ===`)
    console.log('bestOfferTerms:', JSON.stringify(res.bestOfferTerms, null, 2))
    console.log('format:', res.format)
    console.log('status:', res.status)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
