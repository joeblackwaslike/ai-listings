# Auth + User Isolation + Per-User API Keys — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Derived from:** design conversation 2026-04-26

---

## What This Builds

Three tightly coupled concerns implemented together:

1. **Auth** — Google OAuth via Supabase Auth, with a registration gate controlled by env var
2. **User isolation** — `user_id` column on `listings`, RLS policies scoped to owner, child tables isolated via subquery
3. **Per-user API keys** — `user_api_keys` table stores Anthropic/SerpAPI/PhotoRoom keys per user; pipeline and agent use them instead of (or falling back to) env vars; settings page to enter them

**Done when:** Sign in with Google → dashboard shows only your listings → agent chat uses your Anthropic key → `/settings/api-keys` lets you enter/update keys.

---

## Registration Gate

Controlled by two env vars:

```
REGISTRATION_MODE=open|whitelist|closed
ALLOWED_EMAILS=joeblackwaslike@gmail.com
```

| Mode | Behavior |
|------|----------|
| `open` | Any Google account can sign up and log in |
| `whitelist` | Only emails in `ALLOWED_EMAILS` (comma-separated) can sign up or log in |
| `closed` | No new sign-ups; accounts created within the last 60s are rejected and signed out; existing users can still log in |

Initial deploy: `REGISTRATION_MODE=whitelist`, `ALLOWED_EMAILS=joeblackwaslike@gmail.com`.

Gate is applied in the OAuth callback route after the code exchange. If denied: sign out the user, redirect to `/auth/error?reason=not_allowed` or `?reason=closed`.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|----------------|
| `supabase/migrations/0002_auth_user_isolation_api_keys.sql` | Create | user_id column, RLS policies, user_api_keys table |
| `src/middleware.ts` | Create | Refresh session cookie, redirect unauthenticated → `/login` |
| `src/app/login/page.tsx` | Create | "Sign in with Google" button |
| `src/app/auth/callback/route.ts` | Create | Exchange OAuth code, apply registration gate, redirect |
| `src/app/auth/error/page.tsx` | Create | Display not_allowed / closed / generic error |
| `src/lib/user-api-keys.ts` | Create | `getUserApiKeys(userId)` → `ApiKeys`; env var fallback |
| `src/app/api/settings/keys/route.ts` | Create | `PATCH` — upsert one key per request |
| `src/app/settings/api-keys/page.tsx` | Create | Server page: masked key display + form |
| `src/app/api/upload/route.ts` | Modify | Set `user_id` on listing creation |
| `src/lib/inngest/functions/intake-pipeline.ts` | Modify | Fetch `apiKeys` at function start, pass to each step |
| `src/lib/inngest/functions/retry-step.ts` | Modify | Same — fetch apiKeys, pass to step |
| `src/lib/pipeline/step1-product-id.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/lib/pipeline/step2-vision-analysis.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/lib/pipeline/step3-pricing-research.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/lib/pipeline/step4a-draft-listing.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/lib/pipeline/step5-auth-plan.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/lib/agent/chat.ts` | Modify | Accept `apiKeys: ApiKeys` param |
| `src/app/api/agent/[listingId]/route.ts` | Modify | Fetch apiKeys from session user, pass to chat |
| `src/app/api/studio-upload/route.ts` | Modify | Fetch apiKeys from session user, use for PhotoRoom |
| `src/app/api/listings/[id]/publish/route.ts` | Modify | Add `getUser()` 401 guard |

---

## Database Migration

```sql
-- 1. Add user_id to listings
ALTER TABLE listings ADD COLUMN user_id uuid REFERENCES auth.users(id);

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
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('anthropic', 'serpapi', 'photoroom')),
  api_key    text NOT NULL,
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
```

**Seed note:** After running the migration, a one-time seed inserts the current env var API keys as the owner's keys. The seed reads the user_id from `auth.users` where `email = 'joeblackwaslike@gmail.com'` and inserts rows for `anthropic`, `serpapi`, and `photoroom`. This is done via a separate seed SQL script run manually after first login.

---

## `ApiKeys` Type and Helper

```typescript
// src/lib/user-api-keys.ts

export interface ApiKeys {
  anthropic: string
  serpapi: string
  photoroom: string
}

export async function getUserApiKeys(userId: string): Promise<ApiKeys> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('user_api_keys')
    .select('provider, api_key')
    .eq('user_id', userId)

  const keys = Object.fromEntries((data ?? []).map((r) => [r.provider, r.api_key]))

  return {
    anthropic: keys.anthropic ?? process.env.ANTHROPIC_API_KEY ?? '',
    serpapi:   keys.serpapi   ?? process.env.SERPAPI_KEY         ?? '',
    photoroom: keys.photoroom ?? process.env.PHOTOROOM_API_KEY   ?? '',
  }
}
```

Env var fallback means local dev without DB-stored keys continues to work.

---

## Pipeline Refactor Pattern

All 5 step functions gain an `apiKeys: ApiKeys` parameter. They use `apiKeys.anthropic` / `apiKeys.serpapi` / `apiKeys.photoroom` instead of `process.env.*`.

The Inngest function fetches keys once at the start:

```typescript
const listing = await step.run('fetch-listing', async () => {
  const { data } = await getSupabaseAdmin().from('listings').select('user_id').eq('id', listingId).single()
  return data
})

const apiKeys = await step.run('fetch-api-keys', () =>
  getUserApiKeys(listing.user_id)
)

await step.run('step-1', () => runStep1(listingId, photos, apiKeys))
// ...
```

---

## Auth Flow

**Middleware (`src/middleware.ts`):**
- Runs on all paths except `/login`, `/auth/*`, and `/_next/*`
- Calls `supabase.auth.getUser()` to refresh the session token
- If no session: redirect to `/login`

**Login page (`src/app/login/page.tsx`):**
- Single "Sign in with Google" button
- Calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/auth/callback' } })`

**Callback route (`src/app/auth/callback/route.ts`):**
1. Exchange `code` for session via `supabase.auth.exchangeCodeForSession(code)`
2. Get user: `supabase.auth.getUser()`
3. Apply registration gate (check `REGISTRATION_MODE` and email)
4. If denied: `supabase.auth.signOut()` + redirect to `/auth/error?reason=...`
5. If allowed: redirect to `/dashboard`

---

## Settings Page

`/settings/api-keys` — server component:
- Fetches `user_api_keys` for the current user (uses cookie client — RLS handles filtering)
- Displays each provider as a row: name, masked indicator ("••••••••{last4}" if set, "Not set" if missing), input field, Save button
- Does **not** return the full key to the browser — only shows whether it's set

`PATCH /api/settings/keys` body: `{ provider: 'anthropic' | 'serpapi' | 'photoroom', api_key: string }`
- Upserts via `user_api_keys` table using cookie client (user_id comes from session)

---

## API Route Auth Guards

Each of the 4 existing API routes adds at the top:

```typescript
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
```

The upload route also sets `user_id: user.id` when inserting the new listing.

---

## Supabase OAuth Setup (Manual, Pre-Deploy)

In Supabase dashboard → Auth → Providers → Google:
- Enable Google provider
- Paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Google Cloud OAuth app
- Add redirect URL: `{SITE_URL}/auth/callback`

Env vars to add:
```
NEXT_PUBLIC_SITE_URL=https://your-vercel-url.vercel.app
REGISTRATION_MODE=whitelist
ALLOWED_EMAILS=joeblackwaslike@gmail.com
```

---

## Not In This Iteration

- Encrypted storage for API keys (Supabase Vault) — fine for whitelist-of-one
- Key validation on save (test the key against the provider's API)
- Multiple users with separate listing inventories (RLS already handles this; the UI just hasn't been tested for it)
- Sign-out button in the UI (add to header later)
