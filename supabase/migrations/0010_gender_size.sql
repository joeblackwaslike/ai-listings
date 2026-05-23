ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS item_size text;
