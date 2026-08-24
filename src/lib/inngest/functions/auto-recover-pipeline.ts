import { inngest } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

// Closes the gap that made 2026-08-24's incident need ~20 rounds of manual intervention:
// healthcheck-cronjob.yaml (deployment/kubernetes/inngest/) already restarts Inngest itself
// when its scheduler wedges, but nothing recovered the individual runs a restart (or an app
// pod restart) orphans -- Inngest loses its own record of "I sent this step and I'm waiting,"
// so an orphaned run just sits unfinished forever with no error to retry against. Every stuck
// listing that day needed someone watching the dashboard and firing pipeline/resume by hand.
// This does that on a schedule instead.
//
// See migration 0029_auto_recover_pipeline.sql for the detection query. Sized off real
// worst-case per-call latency: oauth-backend.ts's 180s timeout + oauth-concurrency.ts's 15s
// cooldown ≈ 3.25 min per Claude call, and a single listing's remaining steps typically need
// 3-4 calls (step3's comp-scoring batches, step4a, step5 if luxury) -- ~13 min worst case with
// no queue contention at all. 15 min covers that with margin without making a genuinely dead
// run wait half an hour to recover (30 min shipped first, sized for a rare mass-recovery burst
// instead of the common single-listing case -- tightened 2026-08-24 after review).
const STALENESS_MINUTES = 15

export const autoRecoverPipeline = inngest.createFunction(
  {
    id: 'auto-recover-pipeline',
    name: 'Auto-Recover Stalled Pipelines',
    triggers: [{ cron: '*/10 * * * *' }],
  },
  async ({ step }) => {
    const stalled = await step.run('find-stalled', async () => {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase.rpc('find_stalled_resumable_listings', {
        p_staleness_minutes: STALENESS_MINUTES,
      })
      if (error) {
        throw new Error(`auto-recover-pipeline: find_stalled_resumable_listings failed: ${error.message}`)
      }
      return (data ?? []) as Array<{ id: string; sku: string }>
    })

    if (stalled.length === 0) return { recovered: 0, skus: [] }

    // Stamp last_resume_fired_at BEFORE sending the events, not after -- if this run dies
    // between the two, the worst case is a listing waits one extra staleness window before
    // its next recovery attempt (safe), not a duplicate resume fired on top of a legitimate
    // one every cron tick because the stamp never landed (unsafe, the exact bug this exists
    // to prevent).
    await step.run('mark-resume-fired', async () => {
      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({ last_resume_fired_at: new Date().toISOString() })
        .in('id', stalled.map((l) => l.id))
    })

    await step.sendEvent(
      'resume-stalled-listings',
      stalled.map((l) => ({ name: 'pipeline/resume' as const, data: { listingId: l.id } }))
    )

    return { recovered: stalled.length, skus: stalled.map((l) => l.sku) }
  }
)
