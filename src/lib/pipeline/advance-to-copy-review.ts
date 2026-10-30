import type { SupabaseClient } from '@supabase/supabase-js'

const REWRITE_ENTRY_STATUSES = ['condition_gate', 'copy_review', 'in_loop']

/**
 * Drops a prior copy approval before a rewrite. False (nothing changed) when the listing already
 * left the entry statuses, e.g. it was finalized meanwhile, so the rewrite must not run.
 */
export async function clearCopyApproval(supabase: SupabaseClient, listingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('listings')
    .update({ copy_approved_at: null })
    .eq('id', listingId)
    .in('status', REWRITE_ENTRY_STATUSES)
    .select('id')
    .maybeSingle()
  if (error) {
    throw new Error(`description-rewrite: failed to clear copy_approved_at for listing ${listingId} -- ${error.message}`)
  }
  return data !== null
}

/**
 * Where a rewrite that exhausted its retries lands. A rewrite request fails out of copy_review or
 * in_loop (approving the old copy mid-rewrite) back to copy_review with the stale approval dropped.
 */
export function rewriteFailureScope(eventName: string) {
  return eventName === 'listing/rewrite-requested'
    ? { revertStatus: 'copy_review', fromStatuses: ['copy_review', 'in_loop'], extraUpdate: { copy_approved_at: null } }
    : { revertStatus: 'condition_gate', fromStatuses: ['condition_gate'], extraUpdate: { condition_confirmed: false } }
}

/**
 * Moves a listing to copy_review after a rewrite. Matches no row (returns false) when the
 * listing left the entry statuses or condition reassessment reset condition_confirmed.
 */
export async function advanceToCopyReview(
  supabase: SupabaseClient,
  listingId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('listings')
    .update({ status: 'copy_review', copy_approved_at: null })
    .eq('id', listingId)
    .eq('condition_confirmed', true)
    .in('status', ['condition_gate', 'copy_review', 'in_loop'])
    .select('id')
    .maybeSingle()
  if (error) {
    throw new Error(`description-rewrite: failed to advance listing ${listingId} to copy_review -- ${error.message}`)
  }
  return data !== null
}
