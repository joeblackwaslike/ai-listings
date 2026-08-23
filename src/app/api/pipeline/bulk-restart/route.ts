import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()

  // Find all blocked listings for this user that have an intake photo. Excludes archived
  // listings explicitly — agent_blocked can linger true on a listing that was archived by
  // some other path without clearing it, and this query has no other way to tell an actually
  // stuck listing apart from an old archived one someone doesn't want resurrected.
  const { data: blocked, error } = await admin
    .from('listings')
    .select('id, status, pipeline_step')
    .eq('user_id', user.id)
    .eq('agent_blocked', true)
    .neq('status', 'archived')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!blocked || blocked.length === 0) return Response.json({ restarted: 0 })

  const listingIds = blocked.map((r: { id: string }) => r.id)

  // pipeline_step records the last step (1-5) that actually completed for this listing,
  // independent of `status` (step2-vision-analysis.ts:277). A blocked listing with
  // pipeline_step >= 2 already got past id-gate (and gender-gate, if its category needed
  // one) — its failure was downstream, in step 3/4/5. Always re-firing photo/uploaded here
  // restarted every blocked listing from step1, discarding those already-answered gate
  // confirmations and re-asking id/measurements from scratch — repeatedly, once per restart
  // click, on every listing that failed again later the same day (ai-listings dashboard
  // report, 2026-08-21: "more than half the items are still stuck at id or measurement for
  // 3rd+ time"). Listings past step2 are routed through pipeline/resume instead, which
  // drives every remaining step (3, 4, 5) through to completion in one run without touching
  // the gates -- pipeline/retry-step only advances a single step per call, which left
  // "Restart all failed" needing several manual follow-up calls to actually finish a listing
  // (ai-listings dashboard report, 2026-08-21: "why isn't there a restart pipeline call that
  // doesn't require this degree of handholding").
  const fullRestartIds: string[] = []
  const resumeIds: string[] = []
  for (const row of blocked as { id: string; pipeline_step: number | null }[]) {
    const step = row.pipeline_step ?? 0
    if (step < 2) {
      fullRestartIds.push(row.id)
    } else if (step < 5) {
      resumeIds.push(row.id)
    }
    // step >= 5 means the pipeline already finished -- nothing to resume, just unblock below.
  }

  // Fetch intake photos only for listings that need a full restart.
  const { data: photos } = await admin
    .from('photos')
    .select('listing_id, raw_url')
    .in('listing_id', fullRestartIds)
    .eq('type', 'intake')

  const photoByListing = Object.fromEntries(
    (photos ?? []).map((p: { listing_id: string; raw_url: string }) => [p.listing_id, p.raw_url])
  )

  // Clear blocked state before re-firing so onFailure doesn't double-write. status is left
  // alone here -- 'processing' isn't a value listings_status_check allows, so setting it here
  // always failed the whole UPDATE (agent_blocked included) with no error surfaced, meaning
  // a restart never actually cleared the blocked UI state even when the re-fired pipeline
  // run succeeded (ai-listings-0d6). The pipeline's own steps set status as they progress.
  const { error: clearError } = await admin
    .from('listings')
    .update({ agent_blocked: false, agent_blocked_reason: null })
    .in('id', listingIds)

  if (clearError) return Response.json({ error: clearError.message }, { status: 500 })

  // fullRestartIds re-fires photo/uploaded, which re-runs step1 (id-gate) through step2
  // (vision-analysis) from scratch. Leaving status at its stale pre-restart value (in_loop,
  // from the original onFailure write) let both the dashboard card and the listing detail
  // page's inLoopContext() treat the listing as if the automated pipeline had already
  // finished -- the card skipped its processing spinner and showed the raw photo undimmed,
  // and the detail page greeted with "automated analysis is done, upload your studio
  // photos" while step1/step2 were silently re-running in the background (OT-0048, 2026-08-23).
  // Resetting to 'intake' here matches what a brand-new upload gets in upload/route.ts.
  if (fullRestartIds.length > 0) {
    const { error: statusResetError } = await admin
      .from('listings')
      .update({ status: 'intake' })
      .in('id', fullRestartIds)

    if (statusResetError) return Response.json({ error: statusResetError.message }, { status: 500 })
  }

  const fullRestartEvents = fullRestartIds
    .filter((id: string) => photoByListing[id])
    .map((id: string) => ({
      name: 'photo/uploaded' as const,
      data: {
        listingId: id,
        photoUrl: photoByListing[id] as string,
        uploadedAt: new Date().toISOString(),
      },
    }))

  const resumeEvents = resumeIds.map((listingId) => ({
    name: 'pipeline/resume' as const,
    data: { listingId },
  }))

  const events = [...fullRestartEvents, ...resumeEvents]
  if (events.length > 0) {
    await inngest.send(events)
  }

  return Response.json({
    restarted: fullRestartEvents.length,
    resumed: resumeEvents.length,
    skipped: listingIds.length - events.length,
  })
}
