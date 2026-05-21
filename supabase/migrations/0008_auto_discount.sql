-- Per-listing auto-discount overrides (NULL = use global setting)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS auto_discount_enabled BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_discount_pct NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_discount_interval_days INTEGER DEFAULT NULL;
