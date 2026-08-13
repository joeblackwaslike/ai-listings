-- Server-side store for platform-connect OAuth state, replacing the httpOnly cookie the
-- connect/callback routes used to rely on. The callback for eBay/Etsy/Imgur lands on a
-- different public-only domain (joeblack.nyc) than the one the user is authenticated on
-- (napoleon-catfish.ts.net) — browser cookies never cross registrable domains, so the
-- callback route can't see either the session cookie or a cookie set by the connect route.
-- Storing {state -> user_id, platform} server-side lets the callback identify the user by
-- the state param alone, with no cookie needed. Only ever accessed via the service-role
-- client; RLS is enabled with no policies so it's unreachable through the anon/authenticated
-- PostgREST API.
-- code_verifier is only set for the Etsy PKCE flow, which has the same cross-domain problem
-- for its code-verifier cookie as the state cookie does.
CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  code_verifier text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
