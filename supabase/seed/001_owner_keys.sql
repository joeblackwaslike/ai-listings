-- One-time seed: inserts your existing API keys as the owner's keys.
-- Run AFTER first login so auth.users has your row.
-- Replace the placeholder strings with your actual keys.
DO $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT id INTO owner_id FROM auth.users WHERE email = 'joeblackwaslike@gmail.com';
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner not found in auth.users — sign in via Google first, then run this seed.';
  END IF;

  INSERT INTO user_api_keys (user_id, provider, api_key) VALUES
    (owner_id, 'anthropic', 'REPLACE_WITH_ANTHROPIC_API_KEY'),
    (owner_id, 'serpapi',   'REPLACE_WITH_SERPAPI_API_KEY'),
    (owner_id, 'photoroom', 'REPLACE_WITH_PHOTOROOM_API_KEY')
  ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, updated_at = now();
END;
$$;
