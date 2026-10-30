-- Dry-run assertions for 0042. Run inside BEGIN ... ROLLBACK; each marker below is
-- replaced by the migration so seeded rows exist before the backfill runs. The second
-- marker re-runs the whole migration to check a rerun keeps real copy approvals:
--   awk -v m=supabase/migrations/0042_workspace_redesign.sql '/^-- @@MIGRATION@@/{while((getline l < m)>0) print l; close(m); next}1' \
--     supabase/migrations/0042_workspace_redesign.check.sql
-- ids end in the row number: ...0a1 .. ...0b9
INSERT INTO listings (id, status, photos_confirmed, condition_confirmed, agent_blocked, pipeline_step, pipeline_total, inclusions, updated_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'condition_gate', false, true,  false, 5, 5, '[]', '2026-03-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a2', 'finalizing',     true,  true,  false, 5, 5, '[{"item":"box","source":"manual","confirmed":false,"notes":null}]', '2026-02-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a3', 'in_loop',        true,  true,  false, 5, 5, '[]', '2026-01-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a4', 'copy_review',    false, true,  true,  5, 5, '[]', '2026-03-02T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a6', 'published',      false, true,  false, 5, 5, '[]', '2026-03-03T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a7', 'archived',       false, true,  false, 5, 5, '[]', '2026-03-04T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a8', 'sold',           false, true,  false, 5, 5, '[]', '2026-03-05T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a9', 'condition_gate', true,  true,  false, 5, 5, '[]', '2026-03-06T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b0', 'in_loop',        true,  true,  true,  5, 5, '[]', '2026-03-07T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b1', 'in_loop',        true,  true,  false, 3, 5, '[]', '2026-03-08T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b2', 'finalizing',     true,  true,  false, 5, 5, '[{"item":"box","source":"manual","confirmed":true,"notes":null}]', '2025-12-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b3', 'finalizing',     true,  true,  false, 5, 5, '[]', '2025-11-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b4', 'finalizing',     false, true,  false, 5, 5, '[]', '2025-10-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b5', 'in_loop',        false, false, true,  1, 5, '[]', '2026-03-09T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b6', 'in_loop',        true,  true,  false, 5, 5, '[]', '2026-04-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b7', 'finalizing',     true,  true,  false, 5, 5, '[{"item":"box","source":"manual","confirmed":"yes","notes":null}]', '2025-09-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b8', 'finalizing',     true,  true,  false, 5, 5, '{}', '2025-08-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b9', 'finalizing',     true,  true,  false, 5, 5, '[]', '2025-07-01T00:00:00Z');
INSERT INTO listings (id, status, photo_plan) VALUES
  ('00000000-0000-0000-0000-0000000000a5', 'in_loop',
   '[{"shot":"front","status":"taken"},{"shot":"back","status":"verified"},{"shot":"side"}]');
INSERT INTO photos (listing_id, type, raw_url, photoroom_meta) VALUES
  ('00000000-0000-0000-0000-0000000000b0', 'studio', 'x', '{"quality_failed":true}'),
  ('00000000-0000-0000-0000-0000000000b3', 'studio', 'x', '{"quality_failed":true}'),
  ('00000000-0000-0000-0000-0000000000b2', 'studio', 'x', '{"quality_failed":false}'),
  ('00000000-0000-0000-0000-0000000000a2', 'studio', 'x', '{}'),
  ('00000000-0000-0000-0000-0000000000b7', 'studio', 'x', '{}'),
  ('00000000-0000-0000-0000-0000000000b8', 'studio', 'x', '{}');

-- @@MIGRATION@@

DO $$
DECLARE
  r listings;
BEGIN
  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b6';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at = '2026-04-01T00:00:00Z', 'b6 settled in_loop not backfilled';
END $$;

UPDATE listings SET copy_approved_at = '2026-05-05T00:00:00Z' WHERE id = '00000000-0000-0000-0000-0000000000b6';

-- @@MIGRATION@@

DO $$
DECLARE
  r listings;
  plan jsonb;
  msg text;
BEGIN
  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a1';
  ASSERT r.status = 'in_loop' AND r.condition_confirmed = false AND r.copy_approved_at IS NULL, 'a1 early condition_gate not reset';
  ASSERT r.quality_checked_at IS NULL, 'a1 unconfirmed photos got quality_checked_at';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a2';
  ASSERT r.status = 'condition_gate' AND r.copy_approved_at IS NULL AND NOT r.condition_confirmed, 'a2 unconfirmed-inclusion finalizing not sent to condition review';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a3';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at = '2026-01-01T00:00:00Z', 'a3 copy_approved_at not original updated_at';
  ASSERT r.quality_checked_at IS NOT NULL, 'a3 confirmed photos without failures not quality-checked';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a4';
  ASSERT r.status = 'in_loop' AND NOT r.agent_blocked AND r.agent_blocked_kind IS NULL AND r.agent_blocked_reason IS NULL,
    'a4 rewrite_failed block not cleared on the move to in_loop';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a6';
  ASSERT r.status = 'published' AND r.condition_confirmed AND r.copy_approved_at IS NULL, 'a6 published touched';
  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a7';
  ASSERT r.status = 'archived' AND r.condition_confirmed AND r.copy_approved_at IS NULL, 'a7 archived touched';
  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a8';
  ASSERT r.status = 'sold' AND r.condition_confirmed AND r.copy_approved_at IS NULL, 'a8 sold touched';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a9';
  ASSERT r.status = 'condition_gate' AND r.condition_confirmed AND r.copy_approved_at IS NULL, 'a9 confirmed-photos condition_gate changed';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b0';
  ASSERT r.agent_blocked AND r.agent_blocked_kind = 'photo_quality' AND r.copy_approved_at IS NULL, 'b0 photo_quality / blocked must not be approved';
  ASSERT r.status = 'condition_gate' AND NOT r.condition_confirmed, 'b0 blocked in_loop leftover not sent to condition review';
  ASSERT r.quality_checked_at IS NULL, 'b0 quality_failed photo got quality_checked_at';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b1';
  ASSERT r.copy_approved_at IS NULL AND r.status = 'in_loop', 'b1 incomplete pipeline got approval';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b2';
  ASSERT r.status = 'finalizing' AND r.copy_approved_at = '2025-12-01T00:00:00Z', 'b2 passing finalizing lost original updated_at';
  ASSERT r.quality_checked_at IS NOT NULL, 'b2 passing photos not quality-checked';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b3';
  ASSERT r.status = 'condition_gate' AND r.copy_approved_at IS NULL AND NOT r.condition_confirmed, 'b3 quality_failed finalizing not sent to condition review';
  ASSERT r.quality_checked_at IS NULL, 'b3 quality_failed photo got quality_checked_at';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b4';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at IS NULL AND NOT r.condition_confirmed, 'b4 unconfirmed-photos finalizing not reset';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b5';
  ASSERT r.agent_blocked_kind = 'intake_failed', 'b5 intake_failed kind';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b6';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at = '2026-05-05T00:00:00Z', 'b6 rerun overwrote a real copy approval';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b7';
  ASSERT r.status = 'condition_gate' AND r.copy_approved_at IS NULL, 'b7 non-boolean confirmed not treated as unconfirmed';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b8';
  ASSERT r.status = 'finalizing' AND r.copy_approved_at = '2025-08-01T00:00:00Z', 'b8 non-array inclusions broke the gate';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000b9';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at IS NULL AND NOT r.photos_confirmed AND NOT r.condition_confirmed,
    'b9 confirmed photos with no studio photo not reset like unconfirmed photos';
  ASSERT r.quality_checked_at IS NULL, 'b9 got quality_checked_at';

  plan := update_photo_plan('00000000-0000-0000-0000-0000000000a5',
    '[{"shot":"front"},{"shot":"back","status":"pending"},{"shot":"side","status":"verified"},{"shot":"top","status":"verified"},{"shot":"bottom","status":"taken"}]');
  ASSERT jsonb_array_length(plan) = 5, 'plan length wrong';
  ASSERT plan->0->>'status' = 'taken', 'taken lost';
  ASSERT plan->1->>'status' = 'verified', 'verified downgraded';
  ASSERT NOT (plan->2 ? 'status'), 'incoming verified accepted on stored shot';
  ASSERT NOT (plan->3 ? 'status'), 'incoming verified accepted on new shot';
  ASSERT plan->4->>'status' = 'taken', 'new taken shot status dropped';

  BEGIN
    PERFORM update_photo_plan('00000000-0000-0000-0000-0000000000a5', NULL);
    ASSERT false, 'NULL plan accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'photo plan must be%', 'wrong NULL-plan error: ' || msg;
  END;
  BEGIN
    PERFORM update_photo_plan('00000000-0000-0000-0000-0000000000a5', '{}'::jsonb);
    ASSERT false, 'object plan accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'photo plan must be%', 'wrong object-plan error: ' || msg;
  END;
  BEGIN
    PERFORM update_photo_plan('00000000-0000-0000-0000-0000000000ff', '[]');
    ASSERT false, 'missing listing accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'listing not found%', 'wrong missing-listing error: ' || msg;
  END;
  BEGIN
    PERFORM set_photo_shot_status('00000000-0000-0000-0000-0000000000a5', 'back', 'pending');
    ASSERT false, 'verified shot was changed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE '%is verified and cannot change%', 'wrong verified error: ' || msg;
  END;
  BEGIN
    PERFORM set_photo_shot_status('00000000-0000-0000-0000-0000000000ff', 'back', 'taken');
    ASSERT false, 'missing listing accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'listing not found%', 'wrong set-status missing-listing error: ' || msg;
  END;

  plan := set_photo_shot_status('00000000-0000-0000-0000-0000000000a5', 'side', 'taken');
  ASSERT plan->2->>'status' = 'taken' AND plan->0->>'status' = 'taken' AND plan->1->>'status' = 'verified', 'set_photo_shot_status wrong result';
END $$;
