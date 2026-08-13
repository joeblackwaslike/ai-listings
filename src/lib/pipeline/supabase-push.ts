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
  // A background pipeline step can still be in flight (queued, retrying) after the user
  // archives the listing from the UI — without this guard, the step's own progress write
  // silently un-archives it out from under them once it finally completes or fails.
  const { error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', listingId)
    .neq('status', 'archived')

  if (error) {
    throw new Error(`supabase-push: ${error.message}`)
  }
}

export { getSupabaseAdmin }
