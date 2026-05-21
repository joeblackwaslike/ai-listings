import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { PoshmarkAdapter } from '@/lib/platforms/adapters/poshmark'
import { MercariAdapter } from '@/lib/platforms/adapters/mercari'
import { EtsyAdapter } from '@/lib/platforms/adapters/etsy'
import { getEbayCreds, getPoshmarkCreds, getMercariCreds } from '@/lib/platforms/credentials'

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
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    await step.run('sync-orders', async () => {
      const supabase = getSupabaseAdmin()
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

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
                .eq("metadata->>'orderId'", order.orderId)
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
