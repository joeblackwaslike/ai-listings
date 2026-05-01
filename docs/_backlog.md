# Backlog

Task 10 — manual steps (you do these, not Claude):

Supabase dashboard → Auth → Providers → Google → Enable, paste GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, add redirect URL http://localhost:3000/auth/callback
Apply migration — paste supabase/migrations/0002_auth_user_isolation_api_keys.sql into Supabase SQL editor and run
Add to .env.local:

GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=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

NEXT_PUBLIC_SITE_URL=http://localhost:3000
REGISTRATION_MODE=whitelist
ALLOWED_EMAILS=joeblackwaslike@gmail.com

First login — npm run dev → navigate to localhost:3000 → sign in with Google → confirm you land on /dashboard
Run seed — fill in actual key values in supabase/seed/001_owner_keys.sql, paste into Supabase SQL editor and run
Verify — go to /settings/api-keys and confirm all three providers show masked values
Smoke test — upload a photo, open workspace, chat with agent, check publish page
Once manual steps are done, close the beads issue:


bd close ai-listings-s5y --reason="Auth implemented: Google OAuth with whitelist gate, user_id isolation on listings + child tables via RLS subquery, per-user API keys in user_api_keys table, pipeline + agent thread keys from DB, settings page at /settings/api-keys."

---

fix lesson added w/o specifying tags, priority, readd