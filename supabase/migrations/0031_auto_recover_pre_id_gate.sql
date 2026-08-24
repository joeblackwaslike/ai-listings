-- Extends find_stalled_resumable_listings to also cover listings orphaned BEFORE id-gate
-- (pipeline_step < 2) -- confirmed as a real gap 2026-08-24 via OT-0053: its intake-pipeline
-- run died at "product-id"/"vision-analysis" (last history event StepScheduled, ~2 hours with
-- no progress) and the original RPC's `pipeline_step >= 2` guard correctly excluded it, since
-- resume-pipeline explicitly rejects anything below step 2 -- but nothing else was watching
-- for this earlier failure mode either.
--
-- Recovery action differs by stage: a listing that reached id-gate needs pipeline/resume
-- (preserve gate answers, continue from where it left off). A listing that never reached
-- id-gate has no gate answers to preserve and needs a full restart -- re-firing photo/uploaded,
-- which intake-pipeline.ts looks up by listingId rather than inserting new rows, so it's safe
-- to re-fire (same mechanism bulk-restart already uses for this exact case).
--
-- pipeline_step < 2 alone can't distinguish "orphaned" from "a brand new upload actively
-- being processed right now" the way the >= 2 branch can (that one has status='intake' as an
-- exclusive signal, since a normal upload passes through 'intake' only transiently before
-- reaching 'id_gate'). Staleness on updated_at is the only signal available here, same as
-- every other branch.
drop function if exists find_stalled_resumable_listings(int);

create function find_stalled_resumable_listings(p_staleness_minutes int default 15)
returns table (id uuid, sku text, recovery_action text)
language sql
as $$
  select id, sku, 'resume' as recovery_action
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
    )
  union all
  select id, sku, 'restart' as recovery_action
  from listings
  where status = 'intake'
    and pipeline_step < 2
    and updated_at < now() - (p_staleness_minutes || ' minutes')::interval
    and (
      last_resume_fired_at is null
      or last_resume_fired_at < now() - (p_staleness_minutes || ' minutes')::interval
    );
$$;
