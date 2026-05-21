-- Price event history per listing
CREATE TABLE IF NOT EXISTS listing_price_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN ('initial','manual_change','auto_discount','relist')),
  price_cents INTEGER NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listing_price_events_listing_id_idx
  ON listing_price_events(listing_id, created_at DESC);
