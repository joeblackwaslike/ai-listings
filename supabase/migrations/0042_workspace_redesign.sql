-- Workspace redesign: copy approval, quality-check timestamp, blocked kind, per-shot photo status.
-- Not applied automatically. Apply with a single transaction so a failure leaves nothing half-done:
--   psql -1 -v ON_ERROR_STOP=1 -f 0042_workspace_redesign.sql
-- Dry-run with 0042_workspace_redesign.check.sql inside BEGIN ... ROLLBACK.

-- The updated_at trigger bumps every row these UPDATEs touch, so copy_approved_at is
-- backfilled from the snapshot's original updated_at, never from listings.updated_at.
CREATE TABLE IF NOT EXISTS listings_backup_0042 AS
  SELECT id, status, condition_confirmed, agent_blocked, updated_at, photo_plan FROM listings;
ALTER TABLE listings_backup_0042 ENABLE ROW LEVEL SECURITY;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS copy_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_blocked_kind text;

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_agent_blocked_kind_check;
ALTER TABLE listings ADD CONSTRAINT listings_agent_blocked_kind_check
  CHECK (agent_blocked_kind IN ('photo_quality', 'intake_failed', 'rewrite_failed'));

-- 1. agent_blocked_kind from context, before any status moves below.
UPDATE listings l
SET agent_blocked_kind = CASE
  WHEN EXISTS (
    SELECT 1 FROM photos p
    WHERE p.listing_id = l.id AND p.type = 'studio'
      AND p.photoroom_meta->>'quality_failed' = 'true'
  ) THEN 'photo_quality'
  WHEN l.status IN ('condition_gate', 'copy_review') THEN 'rewrite_failed'
  ELSE 'intake_failed'
END
WHERE l.agent_blocked AND l.agent_blocked_kind IS NULL;

-- 2. Rows whose condition/copy confirmation came from the intake photo only.
UPDATE listings
SET condition_confirmed = false,
    copy_approved_at = NULL,
    status = CASE WHEN status IN ('condition_gate', 'copy_review') THEN 'in_loop' ELSE status END
WHERE NOT photos_confirmed
  AND status NOT IN ('finalizing', 'published', 'sold', 'archived');

-- 3. Conservative copy_approved_at for settled in_loop rows.
UPDATE listings l
SET copy_approved_at = b.updated_at
FROM listings_backup_0042 b
WHERE b.id = l.id
  AND l.status = 'in_loop'
  AND l.photos_confirmed
  AND l.condition_confirmed
  AND l.pipeline_step >= l.pipeline_total
  AND NOT l.agent_blocked;

-- 4. finalizing rows must pass the new publish gate or go back to in_loop.
WITH gate AS (
  SELECT l.id,
    l.photos_confirmed
      AND l.condition_confirmed
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(l.inclusions) i
        WHERE coalesce((i->>'confirmed')::boolean, false) = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM photos p
        WHERE p.listing_id = l.id AND p.type = 'studio'
          AND p.photoroom_meta->>'quality_failed' = 'true'
      ) AS passes
  FROM listings l
  WHERE l.status = 'finalizing'
)
UPDATE listings l
SET copy_approved_at = CASE WHEN g.passes THEN b.updated_at ELSE NULL END,
    status = CASE WHEN g.passes THEN l.status ELSE 'in_loop' END,
    condition_confirmed = CASE WHEN NOT g.passes AND NOT l.photos_confirmed THEN false ELSE l.condition_confirmed END
FROM gate g
JOIN listings_backup_0042 b ON b.id = g.id
WHERE l.id = g.id;

-- Only set_photo_shot_status may produce 'verified'. Incoming statuses are honored only for
-- shots with no stored counterpart, and only as 'pending'/'taken'.
CREATE OR REPLACE FUNCTION update_photo_plan(p_listing_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' THEN
    RAISE EXCEPTION 'photo plan must be a JSON array';
  END IF;

  UPDATE listings l
  SET photo_plan = coalesce((
    SELECT jsonb_agg(
      CASE
        WHEN old.shot IS NOT NULL THEN
          (e.shot - 'status') || CASE WHEN old.shot ? 'status'
            THEN jsonb_build_object('status', old.shot->>'status') ELSE '{}'::jsonb END
        WHEN e.shot->>'status' IN ('pending', 'taken') THEN e.shot
        ELSE e.shot - 'status'
      END
      ORDER BY e.ord)
    FROM jsonb_array_elements(p_plan) WITH ORDINALITY AS e(shot, ord)
    LEFT JOIN LATERAL (
      SELECT s.x AS shot FROM jsonb_array_elements(l.photo_plan) WITH ORDINALITY AS s(x, o)
      WHERE s.x->>'shot' = e.shot->>'shot'
      ORDER BY s.o
      LIMIT 1
    ) old ON true
  ), '[]'::jsonb)
  WHERE l.id = p_listing_id
  RETURNING l.photo_plan INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found: %', p_listing_id;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION set_photo_shot_status(p_listing_id uuid, p_shot text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_plan jsonb;
  v_stored text;
  v_ord bigint;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'taken', 'verified') THEN
    RAISE EXCEPTION 'invalid photo shot status: %', p_status;
  END IF;

  SELECT photo_plan INTO v_plan FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found: %', p_listing_id;
  END IF;

  SELECT s.x->>'status', s.o INTO v_stored, v_ord
  FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS s(x, o)
  WHERE s.x->>'shot' = p_shot
  ORDER BY s.o
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shot not found: %', p_shot;
  END IF;
  IF v_stored = 'verified' AND p_status <> 'verified' THEN
    RAISE EXCEPTION 'shot % is verified and cannot change to %', p_shot, p_status;
  END IF;

  UPDATE listings
  SET photo_plan = (
    SELECT jsonb_agg(
      CASE WHEN s.o = v_ord THEN s.x || jsonb_build_object('status', p_status) ELSE s.x END
      ORDER BY s.o)
    FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS s(x, o)
  )
  WHERE id = p_listing_id
  RETURNING photo_plan INTO v_plan;

  RETURN v_plan;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_photo_plan(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_photo_plan(uuid, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION set_photo_shot_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_photo_shot_status(uuid, text, text) TO service_role;
