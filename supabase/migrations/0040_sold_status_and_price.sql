ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_price_cents integer;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at timestamptz;

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN (
    'intake','id_gate','gender_gate','in_loop','condition_gate',
    'copy_review','finalizing','published','archived','sold'
  ));
