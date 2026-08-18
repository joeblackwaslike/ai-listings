-- Default true (not false) is deliberate: existing listings never had a "pending approval"
-- concept for condition, so backfilling them all as false would retroactively block every
-- in-flight listing's Finalize step on a re-assessment they never asked for. true treats
-- existing data as already-implicitly-approved -- application code always writes false
-- explicitly whenever a NEW recalculation runs (condition-reassessment.ts), so the pending
-- state only ever appears going forward, on listings that actually go through the new flow.
-- Same principle as ai-listings-kks's inclusions backfill treating legacy included: true as
-- confirmed: true (0020_inclusions_shape_backfill.sql).
alter table listings
  add column condition_confirmed boolean not null default true;
