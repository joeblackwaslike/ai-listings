-- Platform price event history per listing -- captures the actual price posted live on an
-- external marketplace (e.g. eBay) at the moment a listing publishes. Distinct from
-- listing_price_events (migration 0007), which only ever tracks changes to our own
-- suggested_price_cents/final_price_cents fields and never reflects what was actually posted.
CREATE TABLE IF NOT EXISTS platform_price_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('published')),
  price_cents  INTEGER NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_price_events_listing_id_idx
  ON platform_price_events(listing_id, recorded_at DESC);

ALTER TABLE platform_price_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own platform price events" ON platform_price_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_id AND l.user_id = auth.uid())
  );
