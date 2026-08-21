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
  // independent of `status` (id1-step5-vision-analysis.ts:277). A blocked listing with
  // pipeline_step >= 2 already got past id-gate (and gender-gate, if its category needed
  // one) — its failure was downstream, in step 3/4/5. Always re-firing photo/uploaded here
  // restarted every blocked listing from step1, discarding those already-answered gate
  // confirmations and re-asking id/measurements from scratch — repeatedly, once per restart
  // click, on every listing that failed again later the same day (ai-listings dashboard
  // report, 2026-08-21: "more than half the items are still stuck at id or measurement for
  // 3rd+ time"). Listings past step2 are routed through pipeline/retry-step instead, which
  // resumes the specific failed step from stored listing data without touching the gates.
  const fullRestartIds: string[] = []
  const stepRetries: { listingId: string; step: number }[] = []
  for (const row of blocked as { id: string; pipeline_step: number | null }[]) {
    const step = row.pipeline_step ?? 0
    if (step < 2) {
      fullRestartIds.push(row.id)
    } else if (step < 5) {
      stepRetries.push({ listingId: row.id, step: step + 1 })
    }
    // step >= 5 means the pipeline already finished -- nothing to retry, just unblock below.
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
  // alone -- 'processing' isn't a value listings_status_check allows, so setting it here
  // always failed the whole UPDATE (agent_blocked included) with no error surfaced, meaning
  // a restart never actually cleared the blocked UI state even when the re-fired pipeline
  // run succeeded (ai-listings-0d6). The pipeline's own steps set status as they progress.
  const { error: clearError } = await admin
    .from('listings')
    .update({ agent_blocked: false, agent_blocked_reason: null })
    .in('id', listingIds)

  if (clearError) return Response.json({ error: clearError.message }, { status: 500 })

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

  const stepRetryEvents = stepRetries.map(({ listingId, step }) => ({
    name: 'pipeline/retry-step' as const,
    data: { listingId, step },
  }))

  const events = [...fullRestartEvents, ...stepRetryEvents]
  if (events.length > 0) {
    await inngest.send(events)
  }

  return Response.json({
    restarted: fullRestartEvents.length,
    stepRetried: stepRetryEvents.length,
    skipped: listingIds.length - events.length,
  })
}
