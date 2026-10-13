-- Dry-run assertions for 0042. Run inside BEGIN ... ROLLBACK; the marker below is
-- replaced by the migration so seeded rows exist before the backfill runs:
--   awk -v m=supabase/migrations/0042_workspace_redesign.sql '/^-- @@MIGRATION@@/{while((getline l < m)>0) print l; next}1' \
--     supabase/migrations/0042_workspace_redesign.check.sql
INSERT INTO listings (id, status, photos_confirmed, condition_confirmed) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'condition_gate', false, true);
INSERT INTO listings (id, status, photos_confirmed, condition_confirmed, inclusions) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'finalizing', true, true,
   '[{"item":"box","source":"manual","confirmed":false,"notes":null}]');
INSERT INTO listings (id, status, photos_confirmed, condition_confirmed, pipeline_step, pipeline_total, updated_at) VALUES
  ('00000000-0000-0000-0000-0000000000a3', 'in_loop', true, true, 5, 5, '2026-01-01T00:00:00Z');
INSERT INTO listings (id, status, photos_confirmed, condition_confirmed, agent_blocked) VALUES
  ('00000000-0000-0000-0000-0000000000a4', 'copy_review', false, true, true);
INSERT INTO listings (id, status, photo_plan) VALUES
  ('00000000-0000-0000-0000-0000000000a5', 'in_loop',
   '[{"shot":"front","status":"taken"},{"shot":"back","status":"verified"},{"shot":"side"}]');

-- @@MIGRATION@@

DO $$
DECLARE
  r listings;
  plan jsonb;
BEGIN
  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a1';
  ASSERT r.status = 'in_loop' AND r.condition_confirmed = false, 'early condition_gate not reset';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a2';
  ASSERT r.status = 'in_loop' AND r.copy_approved_at IS NULL, 'finalizing with unconfirmed inclusion not demoted';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a3';
  ASSERT r.copy_approved_at = '2026-01-01T00:00:00Z', 'copy_approved_at not backfilled from updated_at';

  SELECT * INTO r FROM listings WHERE id = '00000000-0000-0000-0000-0000000000a4';
  ASSERT r.agent_blocked_kind = 'rewrite_failed', 'agent_blocked_kind not backfilled';

  plan := update_photo_plan('00000000-0000-0000-0000-0000000000a5',
    '[{"shot":"front"},{"shot":"back","status":"pending"},{"shot":"side"},{"shot":"top"}]');
  ASSERT plan->0->>'status' = 'taken', 'taken lost';
  ASSERT plan->1->>'status' = 'verified', 'verified downgraded';
  ASSERT plan->2->>'status' IS NULL, 'pending shot gained status';
  ASSERT jsonb_array_length(plan) = 4, 'plan length wrong';

  BEGIN
    PERFORM set_photo_shot_status('00000000-0000-0000-0000-0000000000a5', 'back', 'pending');
    ASSERT false, 'verified shot was changed';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;

  plan := set_photo_shot_status('00000000-0000-0000-0000-0000000000a5', 'side', 'taken');
  ASSERT plan->2->>'status' = 'taken', 'set_photo_shot_status did not set';
END $$;
