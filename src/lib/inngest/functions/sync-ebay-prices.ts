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

      for (const userId of userIds) {
        try {
          const creds = await getEbayCreds(userId)
          if (!creds) continue
          const adapter = new EbayAdapter(creds)
          const listings = await adapter.getMyListings({ status: 'active' })

          for (const pl of listings) {
            if (pl.status !== 'active' || !pl.platformId) continue
            const ebayUrl = `https://www.ebay.com/itm/${pl.platformId}`
            const { data: listing } = await supabase
              .from('listings')
              .select('id, final_price_cents')
              .eq('user_id', userId)
              .eq('listing_urls->>ebay', ebayUrl)
              .maybeSingle()
            if (listing && listing.final_price_cents !== pl.price) {
              await supabase
                .from('listings')
                .update({ final_price_cents: pl.price })
                .eq('id', listing.id)
            }
          }
        } catch (err) {
          console.error(`[sync-ebay-prices] error for userId=${userId}:`, err)
          continue
        }
      }
    })
  },
)
