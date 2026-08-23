import { createClient } from '@supabase/supabase-js'
import type { ListingStatus } from '@/types/listings'

interface PipelineUpdate {
  pipeline_step?: number
  status?: ListingStatus
  [column: string]: unknown
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function pushPipelineStep(
  listingId: string,
  updates: PipelineUpdate
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { pipeline_step, ...rest } = updates

  // pipeline_step must never regress, even under two concurrent writers (a manual
  // retry-step racing an in-flight automated run) -- a read-then-write-max in application
  // code has a race window between the read and this write (confirmed by codexreviewbot on
  // PR #53: caller A reads pipeline_step=3, caller B advances it to 4, caller A's now-stale
  // floor of 3 overwrites that 4). Routed through a Postgres-side GREATEST() (migration
  // 0025) so the floor holds regardless of write ordering.
  if (pipeline_step !== undefined) {
    const { error: rpcError } = await supabase.rpc('bump_pipeline_step', {
      p_listing_id: listingId,
      p_min_step: pipeline_step,
    })
    if (rpcError) {
      throw new Error(`supabase-push: bump_pipeline_step failed — ${rpcError.message}`)
    }
  }

  if (Object.keys(rest).length === 0) return

  // A background pipeline step can still be in flight (queued, retrying) after the user
  // archives the listing from the UI — without this guard, the step's own progress write
  // silently un-archives it out from under them once it finally completes or fails.
  const { error } = await supabase
    .from('listings')
    .update(rest)
    .eq('id', listingId)
    .neq('status', 'archived')

  if (error) {
    throw new Error(`supabase-push: ${error.message}`)
  }
}

export { getSupabaseAdmin }
