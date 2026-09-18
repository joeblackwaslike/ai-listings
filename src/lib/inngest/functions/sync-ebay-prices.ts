import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

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

      // eBay GET /offer returns pricingSummary:{} (empty) — prices cannot be read back
      // from this endpoint. DB is source of truth; prices are pushed TO eBay, not FROM it.
      // TODO: repurpose this cron for listing-status sync (PUBLISHED→ENDED detection).
      console.log(`[sync-ebay-prices] ${userIds.length} user(s) — price sync disabled: eBay GET /offer does not return price`)
    })
  },
)
