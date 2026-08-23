-- pushPipelineStep's "never regress pipeline_step" invariant (added earlier in this same PR
-- for step3/4a/5) was a read-then-write-max in application code, which has a real race
-- window: a manual retry-step can read pipeline_step=3 while another in-flight run advances
-- it to 4, and the retry's now-stale floor of 3 overwrites that 4 -- codexreviewbot caught
-- this on PR #53. Move the floor enforcement into Postgres itself via GREATEST() so it holds
-- regardless of write ordering between concurrent callers.
create or replace function bump_pipeline_step(p_listing_id uuid, p_min_step int)
returns void
language sql
as $$
  update listings
  set pipeline_step = greatest(pipeline_step, p_min_step)
  where id = p_listing_id and status != 'archived';
$$;
