-- auto-recover-pipeline.ts always passes p_staleness_minutes explicitly, so this default only
-- matters if the RPC is ever called directly without one. Keeping it in sync with that file's
-- STALENESS_MINUTES (30 -> 15, 2026-08-24) rather than letting the two drift.
create or replace function find_stalled_resumable_listings(p_staleness_minutes int default 15)
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
