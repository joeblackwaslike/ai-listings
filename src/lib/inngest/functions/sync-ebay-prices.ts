import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { getEbayCreds } from '@/lib/platforms/credentials'

export const syncEbayPrices = inngest.createFunction(
  {
    id: 'sync-ebay-prices',
    name: 'Sync eBay Prices',
    triggers: [
      { cron: '0 */6 * * *' },
      { event: 'sync/ebay-prices' },
    ],
  },
  async ({ step }) => {
    await step.run('sync-prices', async () => {
      const supabase = getSupabaseAdmin()

      const { data: rows } = await supabase
        .from('user_settings')
        .select('user_id')
        .eq('setting_key', 'ebay_refresh_token')
        .not('setting_value', 'is', null)
      const userIds = (rows ?? []).map((r) => r.user_id as string)
      console.log(`[sync-ebay-prices] users with eBay creds: ${userIds.length}`)

      for (const userId of userIds) {
        try {
          const creds = await getEbayCreds(userId)
          if (!creds) continue

          // Pull published listings with eBay URLs from DB — use their SKUs directly
          // rather than calling inventory_item list (which returns empty for this account).
          const { data: dbListings, error: dbError } = await supabase
            .from('listings')
            .select('id, sku, final_price_cents')
            .eq('user_id', userId)
            .eq('status', 'published')
            .not('listing_urls->>ebay', 'is', null)
          if (dbError) throw dbError
          if (!dbListings || dbListings.length === 0) {
            console.log(`[sync-ebay-prices] userId=${userId}: no published listings with eBay URLs`)
            continue
          }
          console.log(`[sync-ebay-prices] userId=${userId}: checking ${dbListings.length} listings`)

          const skus = dbListings.map((l) => l.sku as string).filter(Boolean)
          const adapter = new EbayAdapter(creds)
          const offers = await adapter.getOffersBySku(skus)
          console.log(`[sync-ebay-prices] userId=${userId}: got ${offers.length} offers from eBay`)

          // offer.title = offer.sku (set in getOffersBySku) — match back to DB listing
          const offerBySku = new Map(offers.map((o) => [o.title, o]))

          let updated = 0
          for (const listing of dbListings) {
            const offer = offerBySku.get(listing.sku as string)
            if (!offer || offer.status !== 'active') continue
            if (offer.price !== listing.final_price_cents) {
              const { error: updateError } = await supabase
                .from('listings')
                .update({ final_price_cents: offer.price })
                .eq('id', listing.id)
              if (updateError) throw updateError
              console.log(`[sync-ebay-prices] updated sku=${listing.sku}: ${listing.final_price_cents} → ${offer.price}`)
              updated++
            }
          }
          console.log(`[sync-ebay-prices] userId=${userId}: updated ${updated} prices`)
        } catch (err) {
          console.error(`[sync-ebay-prices] error for userId=${userId}:`, err)
          continue
        }
      }
    })
  },
)
