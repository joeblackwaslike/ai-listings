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
      const { data: updated, error: revertError } = await supabase
        .from('listings')
        .update({
          agent_blocked: true,
          agent_blocked_reason: 'Copy rewrite failed after all retries — try re-confirming condition.',
          status: 'condition_gate',
          condition_confirmed: false,
        })
        .eq('id', listingId)
        .eq('status', 'condition_gate')
        .select('id')
        .maybeSingle()
      if (revertError) {
        console.error(`[description-rewrite] onFailure: failed to set agent_blocked for listing ${listingId}`, revertError)
      } else if (!updated) {
        console.warn(`[description-rewrite] onFailure: zero rows updated for listing ${listingId} — listing may no longer be in condition_gate`)
      }
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
      const { data: updated, error } = await supabase
        .from('listings')
        .update({ status: 'in_loop', agent_blocked: false })
        .eq('id', listingId)
        .eq('status', 'condition_gate')
        .select('id')
        .maybeSingle()
      if (error) {
        throw new Error(`description-rewrite: failed to advance listing ${listingId} to in_loop -- ${error.message}`)
      }
      if (!updated) {
        console.warn(`description-rewrite: zero rows updated advancing ${listingId} to in_loop — listing may no longer be in condition_gate (archived or concurrent transition)`)
      }
    })

    return { ok: true, listingId }
  }
)
