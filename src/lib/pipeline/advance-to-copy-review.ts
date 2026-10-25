import type { SupabaseClient } from '@supabase/supabase-js'

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
