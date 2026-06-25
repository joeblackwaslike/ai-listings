ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS skip_background_removal boolean NOT NULL DEFAULT false;
