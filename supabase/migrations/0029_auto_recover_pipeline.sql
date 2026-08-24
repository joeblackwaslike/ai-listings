-- Backs the auto-recover-pipeline Inngest cron function (2026-08-24): every stuck listing
-- from today's incident needed someone to manually notice it and fire a fresh pipeline/resume
-- event -- Inngest has no way to know a run died (its own restart, or the app pod's, drops the
-- in-flight request with no error to retry against; the run just sits unfinished forever).
-- This RPC finds listings in that exact state so the cron function can recover them itself.

-- last_resume_fired_at is the backoff signal: without it, a listing that legitimately takes
-- longer than p_staleness_minutes to finish (this session saw single calls take up to 3
-- minutes, several calls per listing, serialized through a small concurrency limit) would get
-- a duplicate pipeline/resume fired on top of its own still-running attempt every cron cycle.
-- Stamped by the cron function right after it fires resume for a listing; only re-fires once
-- this is itself older than the staleness window, so a listing gets one recovery attempt per
-- window, not one per cron tick.
alter table listings add column if not exists last_resume_fired_at timestamptz;

-- Matches the exact "Processing" criteria StatusBadge.tsx uses on the dashboard (pipeline_step
-- < pipeline_total) instead of a guessed pipeline_step cutoff -- a plain "pipeline_step < 5"
-- check wrongly treated finished non-luxury listings (pipeline_total 4) as done while missing
-- luxury listings genuinely still short of their real total (2026-08-24, caught only because
-- the user counted 5 listings still showing "Processing" after a manual sweep said 0 were).
--
-- The intake/id_gate branch covers the id-gate-confirmed-but-orphaned case (HB-0125,
-- 2026-08-24): confirm-id/route.ts stamps status='intake' optimistically before Inngest even
-- processes the confirmation event, so a listing whose original run died leaves pipeline_step
-- at 2 (past id-gate) with status stuck at 'intake' forever, with nothing else to distinguish
-- it from a normal fresh upload except pipeline_step >= 2 (fresh uploads sit at 0/1 during
-- their own vision-ID pass).
create or replace function find_stalled_resumable_listings(p_staleness_minutes int default 30)
returns table (id uuid, sku text)
language sql
as $$
  select id, sku
  from listings
  where status != 'archived'
    and (
      (status = 'in_loop' and pipeline_step < pipeline_total)
      or (status = 'intake' and pipeline_step >= 2)
    )
    and updated_at < now() - (p_staleness_minutes || ' minutes')::interval
    and (
      last_resume_fired_at is null
      or last_resume_fired_at < now() - (p_staleness_minutes || ' minutes')::interval
    );
$$;
