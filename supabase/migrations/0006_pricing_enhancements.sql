-- Pricing intelligence enhancements
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS price_to_move_cents INTEGER,
  ADD COLUMN IF NOT EXISTS price_to_move_discount_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS retail_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS retail_price_source TEXT,
  ADD COLUMN IF NOT EXISTS retail_promo_note TEXT,
  ADD COLUMN IF NOT EXISTS pricing_methodology TEXT;
