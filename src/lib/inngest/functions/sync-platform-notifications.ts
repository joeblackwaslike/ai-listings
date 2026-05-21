import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { PoshmarkAdapter } from '@/lib/platforms/adapters/poshmark'
import { MercariAdapter } from '@/lib/platforms/adapters/mercari'
import { EtsyAdapter } from '@/lib/platforms/adapters/etsy'
import { MechmarketAdapter } from '@/lib/platforms/adapters/mechmarket'
import {
  getEbayCreds,
  getPoshmarkCreds,
  getMercariCreds,
} from '@/lib/platforms/credentials'

const PLATFORM_CRED_KEYS = [
  { platform: 'ebay', credKey: 'ebay_refresh_token' },
  { platform: 'poshmark', credKey: 'poshmark_cookies' },
  { platform: 'mercari', credKey: 'mercari_api_token' },
  { platform: 'etsy', credKey: 'etsy_refresh_token' },
  { platform: 'mechmarket', credKey: 'reddit_refresh_token' },
] as const

export const syncPlatformNotifications = inngest.createFunction(
  {
    id: 'sync-platform-notifications',
    name: 'Sync Platform Notifications',
    triggers: [{ cron: '*/5 * * * *' }],
  },
  async ({ step }) => {
    await step.run('sync-notifications', async () => {
      const supabase = getSupabaseAdmin()
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000)

      for (const { platform, credKey } of PLATFORM_CRED_KEYS) {
        const { data: rows } = await supabase
          .from('user_settings')
          .select('user_id')
          .eq('setting_key', credKey)
          .not('setting_value', 'is', null)
        const userIds = (rows ?? []).map((r) => r.user_id as string)

        for (const userId of userIds) {
          try {
            let adapter:
              | EbayAdapter
              | PoshmarkAdapter
              | MercariAdapter
              | EtsyAdapter
              | MechmarketAdapter

            if (platform === 'ebay') {
              const creds = await getEbayCreds(userId)
              if (!creds) continue
              adapter = new EbayAdapter(creds)
            } else if (platform === 'poshmark') {
              const creds = await getPoshmarkCreds(userId)
              if (!creds) continue
              adapter = new PoshmarkAdapter(creds)
            } else if (platform === 'mercari') {
              const creds = await getMercariCreds(userId)
              if (!creds) continue
              adapter = new MercariAdapter(creds)
            } else if (platform === 'etsy') {
              adapter = new EtsyAdapter(userId)
            } else {
              // mechmarket
              adapter = new MechmarketAdapter(userId)
            }

            const notifications = await adapter.getNotifications(since)

            for (const notification of notifications) {
              const { data: existing } = await supabase
                .from('notifications')
                .select('id')
                .eq('user_id', userId)
                .eq("metadata->>'platformNotificationId'", notification.notificationId)
                .maybeSingle()

              if (!existing) {
                await supabase.from('notifications').insert({
                  user_id: userId,
                  type:
                    notification.type === 'offer'
                      ? 'offer_received'
                      : notification.type === 'order'
                        ? 'order_placed'
                        : notification.type === 'message'
                          ? 'reddit_message'
                          : 'other',
                  platform: notification.platform,
                  title: notification.title,
                  preview: notification.preview,
                  source_url: notification.url ?? null,
                  metadata: {
                    ...notification.metadata,
                    platformNotificationId: notification.notificationId,
                  },
                  read_at: notification.read ? new Date().toISOString() : null,
                })
              }
            }
          } catch (err) {
            console.error(
              `[sync-platform-notifications] error for platform=${platform} userId=${userId}:`,
              err,
            )
            continue
          }
        }
      }
    })
  },
)
