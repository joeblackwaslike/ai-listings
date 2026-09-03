import { inngest } from '../client'
import type { ListingConditionConfirmedEvent, ListingRewriteRequestedEvent } from '../client'
import { loadApiKeys, runRewriteListing } from '@/lib/pipeline/rewrite-listing'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

type TriggerEvent = ListingConditionConfirmedEvent | ListingRewriteRequestedEvent

export const descriptionRewrite = inngest.createFunction(
  {
    id: 'description-rewrite',
    triggers: [
      { event: 'listing/condition-confirmed' },
      { event: 'listing/rewrite-requested' },
    ],
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.listingId' },
    onFailure: async ({ event }) => {
      const innerEvent = (
        event as unknown as { data: { event: TriggerEvent } }
      ).data.event
      const listingId = innerEvent.data.listingId
      if (!listingId) return

      // Revert to the status the listing was in when this function fired.
      // condition-confirmed path: listing was in condition_gate.
      // rewrite-requested path: listing was in copy_review.
      const revertStatus =
        innerEvent.name === 'listing/rewrite-requested' ? 'copy_review' : 'condition_gate'
      const extraUpdate =
        revertStatus === 'condition_gate' ? { condition_confirmed: false } : {}

      const supabase = getSupabaseAdmin()
      const { data: updated, error: revertError } = await supabase
        .from('listings')
        .update({
          agent_blocked: true,
          agent_blocked_reason: revertStatus === 'copy_review'
            ? 'Copy rewrite failed after all retries — try submitting another rewrite.'
            : 'Copy rewrite failed after all retries — try re-confirming condition.',
          status: revertStatus,
          ...extraUpdate,
        })
        .eq('id', listingId)
        .eq('status', revertStatus)
        .select('id')
        .maybeSingle()
      if (revertError) {
        console.error(`[description-rewrite] onFailure: failed to set agent_blocked for listing ${listingId}`, revertError)
      } else if (!updated) {
        console.warn(`[description-rewrite] onFailure: zero rows updated for listing ${listingId} — may have transitioned away from ${revertStatus}`)
      }
    },
  },
  async ({ event, step }) => {
    const { listingId, extraNotes } = (event as unknown as TriggerEvent).data

    await step.run('rewrite-listing', async () => {
      const apiKeys = await loadApiKeys(listingId)
      return runRewriteListing(listingId, apiKeys, extraNotes ?? '')
    })

    // Advance to copy_review (not in_loop) so the human can review before publishing.
    // CAS guard allows both entry-point statuses: condition_gate (first rewrite) and
    // copy_review (subsequent rewrites from the copy review panel).
    await step.run('transition-to-copy-review', async () => {
      const supabase = getSupabaseAdmin()
      const { data: updated, error } = await supabase
        .from('listings')
        .update({ status: 'copy_review', agent_blocked: false })
        .eq('id', listingId)
        .in('status', ['condition_gate', 'copy_review'])
        .select('id')
        .maybeSingle()
      if (error) {
        throw new Error(`description-rewrite: failed to advance listing ${listingId} to copy_review -- ${error.message}`)
      }
      if (!updated) {
        console.warn(`description-rewrite: zero rows updated advancing ${listingId} to copy_review — listing may be archived or concurrently transitioned`)
      }
    })

    return { ok: true, listingId }
  }
)
