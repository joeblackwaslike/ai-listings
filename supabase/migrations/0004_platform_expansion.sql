-- Migration 0004: Platform expansion tables and constraints
-- Adds: watches/keyboards categories, platform tables, notifications, messages,
--       user_settings, mechmarket tables

-- 1. Update listings.category constraint (add watches + keyboards)
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_category_check;
ALTER TABLE listings ADD CONSTRAINT listings_category_check
  CHECK (category IN ('handbag','clothing','sneakers','electronics','jewelry','collectibles','watches','keyboards','other'));

-- 2. Add watches + keyboards SKU counters
INSERT INTO sku_counters (category_prefix) VALUES ('WA'), ('KB') ON CONFLICT DO NOTHING;

-- 3. Update pricing_comps.source constraint (add reddit, mercari, etsy)
ALTER TABLE pricing_comps DROP CONSTRAINT IF EXISTS pricing_comps_source_check;
ALTER TABLE pricing_comps ADD CONSTRAINT pricing_comps_source_check
  CHECK (source IN ('ebay','poshmark','therealreal','google','reddit','mercari','etsy'));

-- 4. Create user_settings table
CREATE TABLE user_settings (
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key   text NOT NULL,
  setting_value text,
  setting_type  text NOT NULL DEFAULT 'string'
    CHECK (setting_type IN ('string', 'number', 'decimal', 'date', 'json', 'array', 'credential')),
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, setting_key)
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);

-- 5. Create notifications table
CREATE TABLE notifications (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN (
    'reddit_message', 'offer_received', 'order_placed', 'item_sold',
    'listing_question', 'timestamp_warning', 'cooldown_expired',
    'auth_required', 'shipping_reminder', 'other'
  )),
  platform            text,
  title               text NOT NULL,
  preview             text,
  source_url          text,
  related_listing_id  uuid REFERENCES listings(id) ON DELETE SET NULL,
  metadata            jsonb DEFAULT '{}',
  read_at             timestamptz,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX notifications_user_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own notifications" ON notifications
  FOR ALL USING (auth.uid() = user_id);

-- 6. Create messages table
CREATE TABLE messages (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform            text NOT NULL,
  thread_id           text NOT NULL,
  message_id          text NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_username       text NOT NULL,
  body                text NOT NULL,
  related_listing_id  uuid REFERENCES listings(id) ON DELETE SET NULL,
  sent_at             timestamptz NOT NULL,
  read_at             timestamptz,
  metadata            jsonb DEFAULT '{}',
  UNIQUE (platform, message_id)
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own messages" ON messages
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX messages_user_sent_at ON messages (user_id, sent_at DESC);
CREATE INDEX messages_user_thread ON messages (user_id, thread_id);

-- 7. Create listing_platforms table
CREATE TABLE listing_platforms (
  listing_id      uuid REFERENCES listings(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  platform_id     text NOT NULL,
  platform_url    text,
  published_at    timestamptz DEFAULT now(),
  last_synced_at  timestamptz,
  sync_status     text DEFAULT 'ok' CHECK (sync_status IN ('ok', 'error', 'stale')),
  PRIMARY KEY (listing_id, platform)
);

-- 7b. listing_platforms RLS
ALTER TABLE listing_platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own listing platforms" ON listing_platforms
  FOR ALL USING (
    EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_id AND l.user_id = auth.uid())
  );

-- 8. Create mechmarket_posts table
CREATE TABLE mechmarket_posts (
  id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reddit_post_id         text UNIQUE,
  reddit_post_url        text,
  last_promoted_at       timestamptz,
  next_eligible_post_at  timestamptz,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
ALTER TABLE mechmarket_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own mechmarket posts" ON mechmarket_posts
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX mechmarket_posts_user_id ON mechmarket_posts (user_id);

-- 9. Create mechmarket_post_items table
CREATE TABLE mechmarket_post_items (
  post_id                    uuid REFERENCES mechmarket_posts(id) ON DELETE CASCADE,
  listing_id                 uuid REFERENCES listings(id) ON DELETE CASCADE,
  timestamp_photo_url        text,
  timestamp_imgur_album_url  text,
  timestamp_taken_at         timestamptz,
  timestamp_expires_at       timestamptz,  -- set by app: timestamp_taken_at + 14 days (GENERATED not immutable on timestamptz in PG15)
  status                     text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  sort_order                 int DEFAULT 0,
  added_at                   timestamptz DEFAULT now(),
  PRIMARY KEY (post_id, listing_id)
);
ALTER TABLE mechmarket_post_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own mechmarket post items" ON mechmarket_post_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM mechmarket_posts mp WHERE mp.id = post_id AND mp.user_id = auth.uid())
  );
