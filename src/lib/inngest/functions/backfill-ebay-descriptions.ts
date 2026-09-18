import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { getEbayCreds } from '@/lib/platforms/credentials'

export const backfillEbayDescriptions = inngest.createFunction(
  {
    id: 'backfill-ebay-descriptions',
    name: 'Backfill eBay HTML Descriptions',
    triggers: [{ event: 'ebay/backfill-descriptions' }],
  },
  async ({ step }) => {
    await step.run('backfill', async () => {
      const supabase = getSupabaseAdmin()

      const { data: rows } = await supabase
        .from('user_settings')
        .select('user_id')
        .eq('setting_key', 'ebay_refresh_token')
        .not('setting_value', 'is', null)
      const userIds = (rows ?? []).map((r) => r.user_id as string)
      console.log(`[backfill-ebay-descriptions] users with eBay creds: ${userIds.length}`)

      for (const userId of userIds) {
        try {
          const creds = await getEbayCreds(userId)
          if (!creds) continue

          const { data: listings, error } = await supabase
            .from('listings')
            .select('id, sku, platform_fields, listing_urls')
            .eq('user_id', userId)
            .neq('status', 'archived')
            .not('listing_urls->>ebay', 'is', null)
          if (error) throw error
          if (!listings || listings.length === 0) {
            console.log(`[backfill-ebay-descriptions] userId=${userId}: no published eBay listings`)
            continue
          }
          console.log(`[backfill-ebay-descriptions] userId=${userId}: updating ${listings.length} listings`)

          const adapter = new EbayAdapter(creds)
          let updated = 0
          let failed = 0

          for (const listing of listings) {
            const ebayFields = (listing.platform_fields as Record<string, Record<string, string>> | null)?.ebay
            const description = ebayFields?.description
            const listingUrl = (listing.listing_urls as Record<string, string> | null)?.ebay

            if (!description || !listingUrl) continue

            // Extract the eBay listing ID from the URL
            const listingId = listingUrl.split('/itm/')[1]?.split('?')[0]
            if (!listingId) {
              console.log(`[backfill-ebay-descriptions] sku=${listing.sku}: could not parse listing ID from URL`)
              failed++
              continue
            }

            try {
              await adapter.updateListing(listingId, { description })
              console.log(`[backfill-ebay-descriptions] sku=${listing.sku}: updated`)
              updated++
            } catch (err) {
              console.error(`[backfill-ebay-descriptions] sku=${listing.sku}: failed`, err)
              failed++
            }
          }

          console.log(`[backfill-ebay-descriptions] userId=${userId}: updated=${updated} failed=${failed}`)
        } catch (err) {
          console.error(`[backfill-ebay-descriptions] error for userId=${userId}:`, err)
        }
      }
    })
  },
)
