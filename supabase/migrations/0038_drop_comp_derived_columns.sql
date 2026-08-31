-- condition_delta and adjusted_price_cents are derived from (comp.condition, listing.condition)
-- and listing.condition can change after step3 runs, making the stored values stale.
-- Both columns are now calculated dynamically at read time from sale_price_cents + conditions.
ALTER TABLE pricing_comps
  DROP COLUMN IF EXISTS condition_delta,
  DROP COLUMN IF EXISTS adjusted_price_cents;
