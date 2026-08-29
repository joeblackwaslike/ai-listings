import { inngest } from '../client'
import type { ListingConditionConfirmedEvent } from '../client'
import { loadApiKeys, runRewriteListing } from '@/lib/pipeline/rewrite-listing'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export const descriptionRewrite = inngest.createFunction(
  {
    id: 'description-rewrite',
    triggers: [{ event: 'listing/condition-confirmed' }],
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.listingId' },
    onFailure: async ({ event }) => {
      const listingId = (
        event as unknown as { data: { event: ListingConditionConfirmedEvent } }
      ).data.event.data.listingId
      if (!listingId) return
      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({
          agent_blocked: true,
          agent_blocked_reason: 'Copy rewrite failed after all retries — try re-confirming condition.',
          status: 'condition_gate',
          condition_confirmed: false,
        })
        .eq('id', listingId)
    },
  },
  async ({ event, step }) => {
    const { listingId, extraNotes } = (event as unknown as ListingConditionConfirmedEvent).data

    await step.run('rewrite-listing', async () => {
      const apiKeys = await loadApiKeys(listingId)
      return runRewriteListing(listingId, apiKeys, extraNotes)
    })

    // Advance status only after the rewrite succeeds — prevents FinalizeButton from
    // becoming active while copy is still stale (race window between form submit and
    // rewrite completion). Archived listings are never transitioned.
    await step.run('transition-to-in-loop', async () => {
      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({ status: 'in_loop' })
        .eq('id', listingId)
        .neq('status', 'archived')
    })

    return { ok: true, listingId }
  }
)
