-- pushPipelineStep did the pipeline_step floor bump (via bump_pipeline_step, migration 0025)
-- and the rest of a step's field updates (status, brand, etc.) as two separate round trips.
-- A process killed between them (e.g. a pod SIGKILLed mid-request during a deploy) leaves
-- pipeline_step advanced but the accompanying status write lost -- observed 2026-08-23 on 14
-- listings stuck at pipeline_step=2/status='intake' instead of 'id_gate', because
-- step2-vision-analysis's status write never landed. The dashboard's gate cards key off
-- status, not pipeline_step, so those listings had no way to show a card at all, and Inngest
-- kept retrying the *whole* (expensive, Claude-calling) step from scratch since it saw the
-- step as having failed.
--
-- Folds both writes into one RPC call so they commit together: once the single network round
-- trip to Postgres lands, the whole function runs to completion server-side regardless of
-- what happens to the caller afterward.
--
-- p_updates uses the `? 'col'` jsonb "has-key" check per column rather than coalesce(), so an
-- explicit `null` (e.g. clearing agent_blocked_reason) is distinguished from an absent key
-- (leave the column untouched) -- coalesce() can't tell those apart, since a JSON `null` and a
-- missing key both populate the same SQL NULL via jsonb_populate_record.
drop function if exists bump_pipeline_step(uuid, int);

create or replace function bump_pipeline_step(
  p_listing_id uuid,
  p_min_step int,
  p_updates jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  u listings%rowtype;
begin
  u := jsonb_populate_record(null::listings, p_updates);

  update listings
  set
    pipeline_step = greatest(pipeline_step, p_min_step),
    status = case when p_updates ? 'status' then u.status else status end,
    sku = case when p_updates ? 'sku' then u.sku else sku end,
    category = case when p_updates ? 'category' then u.category else category end,
    brand = case when p_updates ? 'brand' then u.brand else brand end,
    condition = case when p_updates ? 'condition' then u.condition else condition end,
    condition_notes = case when p_updates ? 'condition_notes' then u.condition_notes else condition_notes end,
    is_luxury = case when p_updates ? 'is_luxury' then u.is_luxury else is_luxury end,
    inclusions = case when p_updates ? 'inclusions' then u.inclusions else inclusions end,
    photo_plan = case when p_updates ? 'photo_plan' then u.photo_plan else photo_plan end,
    intake_meta = case when p_updates ? 'intake_meta' then u.intake_meta else intake_meta end,
    title = case when p_updates ? 'title' then u.title else title end,
    description = case when p_updates ? 'description' then u.description else description end,
    suggested_price_cents = case when p_updates ? 'suggested_price_cents' then u.suggested_price_cents else suggested_price_cents end,
    platform_fields = case when p_updates ? 'platform_fields' then u.platform_fields else platform_fields end,
    auth_plan = case when p_updates ? 'auth_plan' then u.auth_plan else auth_plan end,
    confidence_score = case when p_updates ? 'confidence_score' then u.confidence_score else confidence_score end,
    price_to_move_cents = case when p_updates ? 'price_to_move_cents' then u.price_to_move_cents else price_to_move_cents end,
    price_to_move_discount_pct = case when p_updates ? 'price_to_move_discount_pct' then u.price_to_move_discount_pct else price_to_move_discount_pct end,
    retail_price_cents = case when p_updates ? 'retail_price_cents' then u.retail_price_cents else retail_price_cents end,
    retail_price_source = case when p_updates ? 'retail_price_source' then u.retail_price_source else retail_price_source end,
    retail_promo_note = case when p_updates ? 'retail_promo_note' then u.retail_promo_note else retail_promo_note end,
    lowest_active_price_cents = case when p_updates ? 'lowest_active_price_cents' then u.lowest_active_price_cents else lowest_active_price_cents end,
    lowest_active_url = case when p_updates ? 'lowest_active_url' then u.lowest_active_url else lowest_active_url end,
    lowest_active_source = case when p_updates ? 'lowest_active_source' then u.lowest_active_source else lowest_active_source end,
    pricing_methodology = case when p_updates ? 'pricing_methodology' then u.pricing_methodology else pricing_methodology end,
    pipeline_total = case when p_updates ? 'pipeline_total' then u.pipeline_total else pipeline_total end,
    agent_blocked = case when p_updates ? 'agent_blocked' then u.agent_blocked else agent_blocked end,
    agent_blocked_reason = case when p_updates ? 'agent_blocked_reason' then u.agent_blocked_reason else agent_blocked_reason end
  where id = p_listing_id and status != 'archived';
end;
$$;

-- Backfill the 14 listings stranded by this exact bug during today's deploy incident: their
-- vision-analysis output was already computed and pipeline_step already advanced to 2, only
-- the status write was lost. Setting status directly (rather than waiting for their retry to
-- re-run the whole expensive Claude call) unblocks their dashboard ID-gate cards immediately.
update listings
set status = 'id_gate'
where status = 'intake'
  and pipeline_step = 2
  and sku is not null;
