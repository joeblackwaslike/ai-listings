import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { getEbayCreds } from '@/lib/platforms/credentials'

/**
 * One-shot recovery: restores listings whose final_price_cents was zeroed by the
 * broken sync-ebay-prices run. Only writes prices > 0 fetched from eBay.
 * Trigger: ebay/restore-prices
 */
export const restoreEbayPrices = inngest.createFunction(
  {
    id: 'restore-ebay-prices',
    name: 'Restore eBay Prices (Recovery)',
    triggers: [{ event: 'ebay/restore-prices' }],
  },
  async ({ step }) => {
    await step.run('restore-prices', async () => {
      const supabase = getSupabaseAdmin()

      const { data: rows } = await supabase
        .from('user_settings')
        .select('user_id')
        .eq('setting_key', 'ebay_refresh_token')
        .not('setting_value', 'is', null)
      const userIds = (rows ?? []).map((r) => r.user_id as string)

      for (const userId of userIds) {
        try {
          const creds = await getEbayCreds(userId)
          if (!creds) continue

          // Target only listings with price=0 that have eBay URLs
          const { data: zeroed, error } = await supabase
            .from('listings')
            .select('id, sku, final_price_cents')
            .eq('user_id', userId)
            .eq('final_price_cents', 0)
            .not('listing_urls->>ebay', 'is', null)
            .neq('status', 'archived')
          if (error) throw error
          if (!zeroed || zeroed.length === 0) {
            console.log(`[restore-ebay-prices] userId=${userId}: no zeroed listings`)
            continue
          }
          console.log(`[restore-ebay-prices] userId=${userId}: found ${zeroed.length} zeroed listings`)

          const skus = zeroed.map((l) => l.sku as string).filter(Boolean)
          const adapter = new EbayAdapter(creds)
          const offers = await adapter.getOffersBySku(skus)
          console.log(`[restore-ebay-prices] userId=${userId}: got ${offers.length} offers from eBay`)

          const offerBySku = new Map(offers.map((o) => [o.title, o]))

          let restored = 0
          let skipped = 0
          for (const listing of zeroed) {
            const offer = offerBySku.get(listing.sku as string)
            if (!offer) {
              console.warn(`[restore-ebay-prices] sku=${listing.sku}: no offer found`)
              skipped++
              continue
            }
            if (offer.price === 0) {
              console.warn(`[restore-ebay-prices] sku=${listing.sku}: offer.price=0 — price field still not parsed correctly, check logs above`)
              skipped++
              continue
            }
            const { error: updateError } = await supabase
              .from('listings')
              .update({ final_price_cents: offer.price })
              .eq('id', listing.id)
            if (updateError) throw updateError
            console.log(`[restore-ebay-prices] restored sku=${listing.sku}: 0 → ${offer.price}`)
            restored++
          }
          console.log(`[restore-ebay-prices] userId=${userId}: restored=${restored} skipped=${skipped}`)
        } catch (err) {
          console.error(`[restore-ebay-prices] error for userId=${userId}:`, err)
        }
      }
    })
  },
)
