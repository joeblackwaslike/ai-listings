-- Add offer-specific columns to notifications for eBay Best Offer events.
-- Also extend the type CHECK to include authenticity notification types.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS offer_id         text,
  ADD COLUMN IF NOT EXISTS offer_amount     numeric,
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_username   text;

-- PostgreSQL names this constraint notifications_type_check automatically.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'reddit_message', 'offer_received', 'order_placed', 'item_sold',
    'listing_question', 'timestamp_warning', 'cooldown_expired',
    'auth_required', 'shipping_reminder', 'other',
    'authenticity_update', 'authenticity_alert'
  ));
