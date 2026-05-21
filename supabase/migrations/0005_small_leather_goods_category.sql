-- Add small_leather_goods category (wallets, cardholders, key pouches, etc.)

-- 1. Update listings category CHECK constraint
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_category_check;
ALTER TABLE listings ADD CONSTRAINT listings_category_check
  CHECK (category IN (
    'handbag','small_leather_goods','clothing','sneakers','electronics',
    'jewelry','collectibles','watches','keyboards','other'
  ));

-- 2. Add SL SKU counter
INSERT INTO sku_counters (category_prefix) VALUES ('SL') ON CONFLICT DO NOTHING;
