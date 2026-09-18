import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { PoshmarkAdapter } from '@/lib/platforms/adapters/poshmark'
import { MercariAdapter } from '@/lib/platforms/adapters/mercari'
import { EtsyAdapter } from '@/lib/platforms/adapters/etsy'
import { getEbayCreds, getPoshmarkCreds, getMercariCreds } from '@/lib/platforms/credentials'
import { getEbayListingIdPattern } from '@/lib/platforms/ebay-utils'

const PLATFORM_CRED_KEYS = [
  { platform: 'ebay', credKey: 'ebay_refresh_token' },
  { platform: 'poshmark', credKey: 'poshmark_cookies' },
  { platform: 'etsy', credKey: 'etsy_refresh_token' },
  { platform: 'mercari', credKey: 'mercari_api_token' },
] as const

export const syncPlatformOrders = inngest.createFunction(
  {
    id: 'sync-platform-orders',
    name: 'Sync Platform Orders',
    triggers: [
      { cron: '*/15 * * * *' },
      { event: 'sync/orders.backfill' },
    ],
  },
  async ({ event, step }) => {
    await step.run('sync-orders', async () => {
      const supabase = getSupabaseAdmin()
      const eventData = (event as unknown as { data?: { since?: string } }).data

      let since: Date
      if (eventData?.since) {
        const parsed = new Date(eventData.since)
        if (Number.isNaN(parsed.getTime())) {
          console.error(`[sync-platform-orders] invalid since date: ${eventData.since}`)
          since = new Date(Date.now() - 24 * 60 * 60 * 1000)
        } else {
          since = parsed
        }
      } else {
        since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      }

      for (const { platform, credKey } of PLATFORM_CRED_KEYS) {
        const { data: rows } = await supabase
          .from('user_settings')
          .select('user_id')
          .eq('setting_key', credKey)
          .not('setting_value', 'is', null)
        const userIds = (rows ?? []).map((r) => r.user_id as string)

        for (const userId of userIds) {
          try {
            let adapter: EbayAdapter | PoshmarkAdapter | MercariAdapter | EtsyAdapter

            if (platform === 'ebay') {
              const creds = await getEbayCreds(userId)
              if (!creds) continue
              adapter = new EbayAdapter(creds)
            } else if (platform === 'poshmark') {
              const creds = await getPoshmarkCreds(userId)
              if (!creds) continue
              adapter = new PoshmarkAdapter(creds)
            } else if (platform === 'etsy') {
              adapter = new EtsyAdapter(userId)
            } else {
              // mercari
              const creds = await getMercariCreds(userId)
              if (!creds) continue
              adapter = new MercariAdapter(creds)
            }

            const orders = await adapter.getOrders(since)

            for (const order of orders) {
              const { data: existing } = await supabase
                .from('notifications')
                .select('id')
                .eq('user_id', userId)
                .filter('metadata->>orderId', 'eq', order.orderId)
                .eq('platform', order.platform)
                .maybeSingle()

              if (!existing) {
                await supabase.from('notifications').insert({
                  user_id: userId,
                  type: 'order_placed',
                  platform: order.platform,
                  title: `New order on ${order.platform}`,
                  preview: `$${(order.salePrice / 100).toFixed(2)} from ${order.buyerUsername}`,
                  metadata: {
                    orderId: order.orderId,
                    salePrice: order.salePrice,
                    buyerUsername: order.buyerUsername,
                  },
                })
              }

              if (order.platform === 'ebay' && order.listingId && order.status !== 'cancelled') {
                const { data: listing, error: lookupError } = await supabase
                  .from('listings')
                  .select('id, status')
                  .eq('user_id', userId)
                  .like('listing_urls->>ebay', getEbayListingIdPattern(order.listingId))
                  .maybeSingle()
                if (lookupError) throw lookupError
                if (listing && listing.status === 'published') {
                  const { error: updateError } = await supabase
                    .from('listings')
                    .update({
                      status: 'sold',
                      sold_price_cents: order.salePrice,
                      sold_at: order.createdAt.toISOString(),
                    })
                    .eq('id', listing.id)
                  if (updateError) throw updateError
                }
              }
            }
          } catch (err) {
            console.error(
              `[sync-platform-orders] error for platform=${platform} userId=${userId}:`,
              err,
            )
            continue
          }
        }
      }
    })
  },
)
