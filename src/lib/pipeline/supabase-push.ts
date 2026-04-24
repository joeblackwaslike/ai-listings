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
  const { error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', listingId)

  if (error) {
    throw new Error(`supabase-push: ${error.message}`)
  }
}

export { getSupabaseAdmin }
