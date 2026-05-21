CREATE TABLE IF NOT EXISTS platform_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  rules_url    TEXT NOT NULL,
  rules_cache  TEXT,
  cached_at    TIMESTAMPTZ,
  UNIQUE (user_id, platform)
);
