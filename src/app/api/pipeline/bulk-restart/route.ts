import { createClient } from '@/lib/supabase/server'

// This endpoint used to select every agent_blocked=true listing for the user and re-fire its
// pipeline (photo/uploaded or pipeline/resume), on the theory that agent_blocked meant a
// failed/stuck run. It doesn't -- agent_blocked is a deliberate hold for human review (e.g.
// suspected counterfeit pending professional authentication), independent of
// agent_blocked_reason, and re-firing the pipeline for one is one click away from bypassing
// that hold. There is also no other "failed" signal in this schema (ListingStatus has no
// failed/error state) for this endpoint to fall back to detecting instead: genuinely
// stalled/orphaned pipeline runs -- the thing the old step-aware routing here was actually
// trying to recover -- are now handled automatically by auto-recover-pipeline.ts's cron
// (find_stalled_resumable_listings, migration 0031). Unblocking a held listing stays an
// explicit, individual, per-card action (ListingCard.tsx / StatusBadge.tsx's "Needs you"
// state), never a bulk one. Kept as an authenticated no-op rather than removed outright so a
// stale client still gets a clean response instead of a 404.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  return Response.json({ restarted: 0 })
}
