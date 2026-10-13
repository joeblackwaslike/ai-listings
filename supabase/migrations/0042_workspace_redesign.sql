-- Workspace redesign: copy approval, quality-check timestamp, blocked kind, per-shot photo status.
-- Not applied automatically. Dry-run with 0042_workspace_redesign.check.sql inside BEGIN ... ROLLBACK.

CREATE TABLE listings_backup_0042 AS
  SELECT id, status, condition_confirmed, agent_blocked FROM listings;

ALTER TABLE listings
  ADD COLUMN copy_approved_at timestamptz,
  ADD COLUMN quality_checked_at timestamptz,
  ADD COLUMN agent_blocked_kind text
    CONSTRAINT listings_agent_blocked_kind_check
    CHECK (agent_blocked_kind IN ('photo_quality', 'intake_failed', 'rewrite_failed'));

-- The updated_at trigger would bump every touched row and corrupt the
-- copy_approved_at = updated_at backfill, so pause it for the data fixes.
ALTER TABLE listings DISABLE TRIGGER listings_updated_at;

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
WHERE l.agent_blocked;

-- 2. Rows whose condition/copy confirmation came from the intake photo only.
UPDATE listings
SET condition_confirmed = false,
    copy_approved_at = NULL,
    status = CASE WHEN status IN ('condition_gate', 'copy_review') THEN 'in_loop' ELSE status END
WHERE NOT photos_confirmed
  AND status NOT IN ('finalizing', 'published', 'sold', 'archived');

-- 3. Conservative copy_approved_at for settled in_loop rows.
UPDATE listings
SET copy_approved_at = updated_at
WHERE status = 'in_loop'
  AND photos_confirmed
  AND condition_confirmed
  AND pipeline_step >= pipeline_total
  AND NOT agent_blocked;

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
SET copy_approved_at = CASE WHEN g.passes THEN l.updated_at ELSE NULL END,
    status = CASE WHEN g.passes THEN l.status ELSE 'in_loop' END,
    condition_confirmed = CASE WHEN NOT g.passes AND NOT l.photos_confirmed THEN false ELSE l.condition_confirmed END
FROM gate g
WHERE l.id = g.id;

ALTER TABLE listings ENABLE TRIGGER listings_updated_at;

CREATE OR REPLACE FUNCTION update_photo_plan(p_listing_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE sql
AS $$
  UPDATE listings l
  SET photo_plan = coalesce((
    SELECT jsonb_agg(
      CASE
        WHEN e.shot->>'status' = 'verified' THEN e.shot
        WHEN old.shot ? 'status' THEN e.shot || jsonb_build_object('status', old.shot->>'status')
        ELSE e.shot
      END
      ORDER BY e.ord
    )
    FROM jsonb_array_elements(p_plan) WITH ORDINALITY AS e(shot, ord)
    LEFT JOIN LATERAL (
      SELECT s AS shot FROM jsonb_array_elements(l.photo_plan) s
      WHERE s->>'shot' = e.shot->>'shot'
      LIMIT 1
    ) old ON true
  ), '[]'::jsonb)
  WHERE l.id = p_listing_id
  RETURNING l.photo_plan;
$$;

CREATE OR REPLACE FUNCTION set_photo_shot_status(p_listing_id uuid, p_shot text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan jsonb;
  v_stored text;
BEGIN
  IF p_status NOT IN ('pending', 'taken', 'verified') THEN
    RAISE EXCEPTION 'invalid photo shot status: %', p_status;
  END IF;

  SELECT photo_plan INTO v_plan FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found: %', p_listing_id;
  END IF;

  SELECT s->>'status' INTO v_stored
  FROM jsonb_array_elements(v_plan) s WHERE s->>'shot' = p_shot LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shot not found: %', p_shot;
  END IF;
  IF v_stored = 'verified' AND p_status <> 'verified' THEN
    RAISE EXCEPTION 'shot % is verified and cannot change to %', p_shot, p_status;
  END IF;

  UPDATE listings
  SET photo_plan = (
    SELECT jsonb_agg(
      CASE WHEN s.shot->>'shot' = p_shot
        THEN s.shot || jsonb_build_object('status', p_status)
        ELSE s.shot END
      ORDER BY s.ord)
    FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS s(shot, ord)
  )
  WHERE id = p_listing_id
  RETURNING photo_plan INTO v_plan;

  RETURN v_plan;
END;
$$;
