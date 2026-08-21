-- Atomic check-and-insert for the live-recomputed gate/greeting messages in
-- src/app/listings/[id]/page.tsx, replacing a read-history-then-conditionally-insert pattern
-- that raced under concurrent page loads (AutoRefresh polling, multiple tabs, fast reloads):
-- two overlapping requests could both read "last message differs from the fresh prompt" off
-- a `history` snapshot fetched moments earlier, and both insert, producing a duplicate
-- id-gate/gender-gate prompt seconds apart -- confirmed live on HB-0102 and SN-0035
-- (ai-listings dashboard report, 2026-08-21). Locking the listing row for the duration of the
-- transaction serializes concurrent calls for the same listing_id, so the "does this already
-- match the last message" check always runs against the true current state, not a stale read.
create or replace function insert_conversation_if_new(
  p_listing_id uuid,
  p_role text,
  p_content text
)
returns boolean
language plpgsql
as $$
declare
  v_last_content text;
begin
  perform 1 from listings where id = p_listing_id for update;

  select content into v_last_content
  from conversations
  where listing_id = p_listing_id
  order by created_at desc
  limit 1;

  if v_last_content is not distinct from p_content then
    return false;
  end if;

  insert into conversations (listing_id, role, content, context_snapshot)
  values (p_listing_id, p_role, p_content, null);

  return true;
end;
$$;
