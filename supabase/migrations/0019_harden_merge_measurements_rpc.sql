-- Harden merge_listing_measurements (0018) at the database boundary, per PR #39 review
-- (coderabbitai): reject a non-object JSONB patch, and restrict EXECUTE to service_role only.
-- This RPC is only ever meant to be called from the Next.js route via getSupabaseAdmin()'s
-- service-role client -- a direct call via PostgREST's /rpc/ endpoint under the anon or
-- authenticated role would bypass the route's EDITABLE_KEYS allow-list and positive-number
-- validation, letting an authenticated caller write arbitrary keys/shapes into their own
-- listing's measurements (still scoped to their own row by the WHERE clause and RLS, but not
-- key/shape-validated). Postgres functions default to PUBLIC execute, and this repo's only
-- other RPC (generate_sku) has no grants -- this is a deliberately narrower posture for this
-- function specifically (it's the first RPC in this repo that's meant to be admin-only), not a
-- retroactive change to that precedent.
create or replace function merge_listing_measurements(
  p_listing_id uuid,
  p_user_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_measurements jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) != 'object' then
    raise exception 'p_patch must be a JSON object';
  end if;

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

revoke execute on function merge_listing_measurements(uuid, uuid, jsonb) from public;
revoke execute on function merge_listing_measurements(uuid, uuid, jsonb) from anon;
revoke execute on function merge_listing_measurements(uuid, uuid, jsonb) from authenticated;
grant execute on function merge_listing_measurements(uuid, uuid, jsonb) to service_role;
