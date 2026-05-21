import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { MechmarketAdapter } from '@/lib/platforms/adapters/mechmarket'
import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { getEbayCreds } from '@/lib/platforms/credentials'

const PLATFORM_CRED_KEYS = [
  { platform: 'mechmarket', credKey: 'reddit_refresh_token' },
  { platform: 'ebay', credKey: 'ebay_refresh_token' },
] as const

export const syncPlatformMessages = inngest.createFunction(
  {
    id: 'sync-platform-messages',
    name: 'Sync Platform Messages',
    triggers: [{ cron: '*/5 * * * *' }],
  },
  async ({ step }) => {
    await step.run('sync-messages', async () => {
      const supabase = getSupabaseAdmin()

      for (const { platform, credKey } of PLATFORM_CRED_KEYS) {
        const { data: rows } = await supabase
          .from('user_settings')
          .select('user_id')
          .eq('setting_key', credKey)
          .not('setting_value', 'is', null)
        const userIds = (rows ?? []).map((r) => r.user_id as string)

        for (const userId of userIds) {
          try {
            let adapter: MechmarketAdapter | EbayAdapter

            if (platform === 'mechmarket') {
              adapter = new MechmarketAdapter(userId)
            } else {
              const creds = await getEbayCreds(userId)
              if (!creds) continue
              adapter = new EbayAdapter(creds)
            }

            const threads = await adapter.getThreads()

            for (const thread of threads) {
              if (thread.unreadCount <= 0) continue

              const messages = await adapter.getThread(thread.threadId)

              for (const msg of messages) {
                const { error: upsertError } = await supabase
                  .from('messages')
                  .upsert(
                    {
                      user_id: userId,
                      platform: msg.platform,
                      thread_id: msg.threadId,
                      message_id: msg.messageId,
                      direction: 'inbound',
                      from_username: msg.from,
                      body: msg.body,
                      sent_at: msg.sentAt.toISOString(),
                      read_at: msg.read ? new Date().toISOString() : null,
                      metadata: {},
                    },
                    { onConflict: 'platform,message_id', ignoreDuplicates: true },
                  )

                if (upsertError) {
                  console.error(
                    `[sync-platform-messages] upsert error for platform=${platform} messageId=${msg.messageId}:`,
                    upsertError,
                  )
                  continue
                }

                if (!msg.read) {
                  await supabase.from('notifications').insert({
                    user_id: userId,
                    type: platform === 'mechmarket' ? 'reddit_message' : 'listing_question',
                    platform,
                    title: `New message from ${msg.from}`,
                    preview: msg.body.slice(0, 200),
                    metadata: { threadId: msg.threadId, messageId: msg.messageId },
                  })
                }
              }
            }
          } catch (err) {
            console.error(
              `[sync-platform-messages] error for platform=${platform} userId=${userId}:`,
              err,
            )
            continue
          }
        }
      }
    })
  },
)
