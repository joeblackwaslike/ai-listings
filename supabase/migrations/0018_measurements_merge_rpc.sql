-- Atomic JSONB merge for listings.measurements, replacing the read-in-app-code/merge/write
-- pattern in PATCH /api/listings/[id]/measurements, which could silently lose a concurrent
-- PATCH's fields (lost-update race -- ai-listings-0en). The merge happens inside the UPDATE's
-- SET clause so it always applies against the current on-disk value, not a value read moments
-- earlier by the caller; concurrent calls for the same listing serialize on Postgres's normal
-- row lock instead of racing in application code.
--
-- Ownership is enforced in the same statement (WHERE id = ... AND user_id = ...) rather than
-- via a separate SELECT beforehand, so a mismatched/missing owner naturally returns zero rows --
-- surfaced to the caller as NULL rather than a partial read exposing whether the row exists.
create or replace function merge_listing_measurements(
  p_listing_id uuid,
  p_user_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_measurements jsonb;
begin
  update listings
    set measurements = coalesce(measurements, '{}'::jsonb) || p_patch
    where id = p_listing_id
      and user_id = p_user_id
    returning measurements into v_measurements;

  if not found then
    return null;
  end if;

  return v_measurements;
end;
$$;
