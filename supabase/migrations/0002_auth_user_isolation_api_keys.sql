-- 1. Add user_id to listings (nullable — existing rows have no owner yet)
ALTER TABLE listings ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Replace permissive policies with owner-scoped policies
DROP POLICY "authenticated_full_access" ON listings;
DROP POLICY "authenticated_full_access" ON photos;
DROP POLICY "authenticated_full_access" ON pricing_comps;
DROP POLICY "authenticated_full_access" ON conversations;

CREATE POLICY "owner_access" ON listings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner_access" ON photos
  FOR ALL TO authenticated
  USING (listing_id IN (SELECT id FROM listings WHERE user_id = auth.uid()));

CREATE POLICY "owner_access" ON pricing_comps
  FOR ALL TO authenticated
  USING (listing_id IN (SELECT id FROM listings WHERE user_id = auth.uid()));

CREATE POLICY "owner_access" ON conversations
  FOR ALL TO authenticated
  USING (listing_id IN (SELECT id FROM listings WHERE user_id = auth.uid()));

-- 3. user_api_keys table
CREATE TABLE user_api_keys (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text        NOT NULL CHECK (provider IN ('anthropic', 'serpapi', 'photoroom')),
  api_key    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_access" ON user_api_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX listings_user_id_idx ON listings(user_id);
