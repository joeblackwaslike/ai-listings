import { inngest } from '../client'
import type { ListingConditionConfirmedEvent, ListingRewriteRequestedEvent } from '../client'
import { loadApiKeys, runRewriteListing } from '@/lib/pipeline/rewrite-listing'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { advanceToCopyReview } from '@/lib/pipeline/advance-to-copy-review'
import { blockedUpdate, unblockedUpdate } from '@/lib/pipeline/pipeline-end'

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
          ...blockedUpdate('rewrite_failed', revertStatus === 'copy_review'
            ? 'Copy rewrite failed after all retries — try submitting another rewrite.'
            : 'Copy rewrite failed after all retries — try re-confirming condition.'),
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

    await step.run('clear-copy-approval', async () => {
      const { error } = await getSupabaseAdmin()
        .from('listings')
        .update({ copy_approved_at: null })
        .eq('id', listingId)
        .neq('status', 'archived')
      if (error) {
        throw new Error(`description-rewrite: failed to clear copy_approved_at for listing ${listingId} -- ${error.message}`)
      }
    })

    await step.run('rewrite-listing', async () => {
      const apiKeys = await loadApiKeys(listingId)
      return runRewriteListing(listingId, apiKeys, extraNotes ?? '')
    })

    // Advance to copy_review (not in_loop) so the human can review before publishing.
    // CAS guard (advanceToCopyReview) also requires condition_confirmed; entry statuses: condition_gate (first rewrite) and
    // copy_review (subsequent rewrites from the copy review panel), plus in_loop: copy approved
    // while this rewrite ran approved the old text, so the new text goes back for review.
    await step.run('transition-to-copy-review', async () => {
      const supabase = getSupabaseAdmin()
      const advanced = await advanceToCopyReview(supabase, listingId)
      if (!advanced) {
        console.warn(`description-rewrite: skipped advancing ${listingId} to copy_review — listing archived, concurrently transitioned, or condition no longer confirmed`)
        return
      }
      // Clear only this function's own failure; a photo_quality block still needs the seller.
      const { error: unblockError } = await supabase
        .from('listings')
        .update(unblockedUpdate())
        .eq('id', listingId)
        .eq('agent_blocked_kind', 'rewrite_failed')
      if (unblockError) {
        throw new Error(`description-rewrite: failed to clear rewrite_failed block for listing ${listingId} -- ${unblockError.message}`)
      }
    })

    return { ok: true, listingId }
  }
)
