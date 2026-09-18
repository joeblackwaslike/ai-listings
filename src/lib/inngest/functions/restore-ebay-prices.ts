import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { getEbayCreds } from '@/lib/platforms/credentials'

const EBAY_LISTING_ID_RE = /\/itm\/(\d+)/

function extractListingId(url: string): string | null {
  return EBAY_LISTING_ID_RE.exec(url)?.[1] ?? null
}

/**
 * One-shot recovery: restores listings whose final_price_cents was zeroed by the
 * broken sync-ebay-prices run. Uses Browse API to get real prices from eBay.
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

          const { data: zeroed, error } = await supabase
            .from('listings')
            .select('id, sku, final_price_cents, listing_urls')
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

          const listingIdToRow = new Map<string, typeof zeroed[number]>()
          for (const row of zeroed) {
            const ebayUrl = (row.listing_urls as Record<string, string> | null)?.ebay
            if (!ebayUrl) continue
            const listingId = extractListingId(ebayUrl)
            if (listingId) listingIdToRow.set(listingId, row)
          }

          const adapter = new EbayAdapter(creds)
          const priceMap = await adapter.getPricesByListingId([...listingIdToRow.keys()])
          console.log(`[restore-ebay-prices] userId=${userId}: got prices for ${priceMap.size}/${listingIdToRow.size} listings`)

          let restored = 0
          let skipped = 0
          for (const [listingId, ebayPrice] of priceMap) {
            const row = listingIdToRow.get(listingId)
            if (!row) continue
            const { error: updateError } = await supabase
              .from('listings')
              .update({ final_price_cents: ebayPrice })
              .eq('id', row.id)
            if (updateError) throw updateError
            console.log(`[restore-ebay-prices] restored sku=${row.sku}: 0 → ${ebayPrice}`)
            restored++
          }
          for (const [listingId] of listingIdToRow) {
            if (!priceMap.has(listingId)) {
              const row = listingIdToRow.get(listingId)
              console.warn(`[restore-ebay-prices] sku=${row?.sku}: no price from Browse API`)
              skipped++
            }
          }
          console.log(`[restore-ebay-prices] userId=${userId}: restored=${restored} skipped=${skipped}`)
        } catch (err) {
          console.error(`[restore-ebay-prices] error for userId=${userId}:`, err)
        }
      }
    })
  },
)
