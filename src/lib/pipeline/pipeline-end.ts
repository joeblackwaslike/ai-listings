import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentBlockedKind, Listing, ListingStatus } from '@/types/listings'

const NOT_SETTLED_STATUSES: ReadonlySet<ListingStatus> = new Set(['intake', 'id_gate', 'gender_gate', 'published', 'sold', 'archived'])

/**
 * True once every pipeline step has run and the listing is neither waiting at a pre-photo gate nor shipped/archived.
 * Photos must not be confirmed before this: condition review and copy review only make sense
 * on a finished draft.
 */
export function pipelineSettled(l: Pick<Listing, 'status' | 'pipeline_step' | 'pipeline_total'>): boolean {
  return l.pipeline_step >= l.pipeline_total && !NOT_SETTLED_STATUSES.has(l.status)
}

/**
 * Status fields a finished pipeline writes. A listing whose studio photos are already confirmed
 * goes straight to condition review; otherwise it waits in in_loop for the photo shoot.
 */
export function pipelineEndUpdate(totalSteps: number, photosConfirmed: boolean) {
  return {
    status: photosConfirmed ? ('condition_gate' as const) : ('in_loop' as const),
    condition_confirmed: false,
    pipeline_total: totalSteps,
  }
}

/**
 * Lands a finished pipeline without a read-then-write race: the unconfirmed-photos write goes
 * first, so photos confirmed between the two writes still end in condition review, and photos
 * confirmed after both emit listing/photos-confirmed, whose reassessment does the same. Only the
 * pipeline's own intake_failed block is cleared; a photo_quality block waits on the seller.
 */
export async function finishPipeline(supabase: SupabaseClient, listingId: string, totalSteps: number): Promise<void> {
  for (const photosConfirmed of [false, true]) {
    const { error } = await supabase
      .from('listings')
      .update(pipelineEndUpdate(totalSteps, photosConfirmed))
      .eq('id', listingId)
      .eq('photos_confirmed', photosConfirmed)
      .neq('status', 'archived')
    if (error) throw new Error(`finishPipeline: status update failed — ${error.message}`)
  }

  const { error } = await supabase
    .from('listings')
    .update(unblockedUpdate())
    .eq('id', listingId)
    .eq('agent_blocked_kind', 'intake_failed')
  if (error) throw new Error(`finishPipeline: unblock failed — ${error.message}`)
}

export function blockedUpdate(kind: AgentBlockedKind, reason: string) {
  return { agent_blocked: true, agent_blocked_reason: reason, agent_blocked_kind: kind }
}

export function unblockedUpdate() {
  return { agent_blocked: false, agent_blocked_reason: null, agent_blocked_kind: null }
}
