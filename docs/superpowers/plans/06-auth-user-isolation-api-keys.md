# Auth + User Isolation + Per-User API Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth auth with a registration gate, scope all listing data to the owning user via RLS, and store Anthropic/SerpAPI/PhotoRoom API keys per user in the DB with a settings page to manage them.

**Architecture:** Supabase Auth handles the Google OAuth flow; a Next.js middleware refreshes session cookies and gates unauthenticated requests. A `user_id` column on `listings` plus owner-scoped RLS policies provide data isolation. A `user_api_keys` table stores per-user API credentials; a `getUserApiKeys()` helper fetches them (with dev-only env var fallback) and threads them through the pipeline and agent as an `ApiKeys` bundle passed explicitly to each step.

**Tech Stack:** `@supabase/ssr`, Next.js 16 middleware, Supabase Auth Google provider, Supabase RLS, TypeScript strict.

**eBay credentials note:** `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are app-level OAuth credentials (not per-user API keys with per-call cost). Leave them as env vars — do not add to `user_api_keys`.

---

## File Map

| File | Action |
|------|--------|
| `supabase/migrations/0002_auth_user_isolation_api_keys.sql` | Create |
| `supabase/seed/001_owner_keys.sql` | Create (template, run manually) |
| `src/lib/user-api-keys.ts` | Create |
| `src/middleware.ts` | Create |
| `src/app/login/page.tsx` | Create |
| `src/app/auth/callback/route.ts` | Create |
| `src/app/auth/error/page.tsx` | Create |
| `src/lib/pipeline/step1-product-id.ts` | Modify |
| `src/lib/pipeline/step2-vision-analysis.ts` | Modify |
| `src/lib/pipeline/step3-pricing-research.ts` | Modify |
| `src/lib/pipeline/step4a-draft-listing.ts` | Modify |
| `src/lib/pipeline/step4b-photoroom.ts` | Modify |
| `src/lib/pipeline/step5-auth-plan.ts` | Modify |
| `src/lib/inngest/functions/intake-pipeline.ts` | Modify |
| `src/lib/inngest/functions/retry-step.ts` | Modify |
| `src/lib/agent/chat.ts` | Modify |
| `src/app/api/agent/[listingId]/route.ts` | Modify |
| `src/app/api/upload/route.ts` | Modify |
| `src/app/api/studio-upload/route.ts` | Modify |
| `src/app/api/listings/[id]/publish/route.ts` | Modify |
| `src/app/api/settings/keys/route.ts` | Create |
| `src/app/settings/api-keys/ApiKeyRow.tsx` | Create |
| `src/app/settings/api-keys/page.tsx` | Create |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0002_auth_user_isolation_api_keys.sql`
- Create: `supabase/seed/001_owner_keys.sql`

- [ ] **Step 1.1: Create migration file**

```bash
mkdir -p supabase/migrations supabase/seed
```

Write `supabase/migrations/0002_auth_user_isolation_api_keys.sql`:

```sql
-- 1. Add user_id to listings (nullable — existing rows have no owner yet)
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
```

- [ ] **Step 1.2: Create seed template**

Write `supabase/seed/001_owner_keys.sql` (fill in actual key values before running):

```sql
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
```

- [ ] **Step 1.3: Apply migration**

In Supabase dashboard → SQL editor, paste and run the migration file. Alternatively via Supabase CLI: `supabase db push`.

Verify: `listings` table has `user_id` column. `user_api_keys` table exists. RLS policies updated.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/0002_auth_user_isolation_api_keys.sql supabase/seed/001_owner_keys.sql
git commit -m "feat: migration — user_id on listings, owner RLS, user_api_keys table"
```

---

## Task 2: ApiKeys helper

**Files:**
- Create: `src/lib/user-api-keys.ts`

- [ ] **Step 2.1: Create helper**

Write `src/lib/user-api-keys.ts`:

```typescript
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export interface ApiKeys {
  anthropic: string
  serpapi: string
  photoroom: string
}

export async function getUserApiKeys(userId: string | null | undefined): Promise<ApiKeys> {
  const isDev = process.env.NODE_ENV !== 'production'

  if (!userId) {
    return {
      anthropic: isDev ? (process.env.ANTHROPIC_API_KEY ?? '') : '',
      serpapi:   isDev ? (process.env.SERPAPI_API_KEY   ?? '') : '',
      photoroom: isDev ? (process.env.PHOTOROOM_API_KEY ?? '') : '',
    }
  }

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('user_api_keys')
    .select('provider, api_key')
    .eq('user_id', userId)

  const keys = Object.fromEntries(
    (data ?? []).map((r) => [r.provider, r.api_key as string])
  )

  return {
    anthropic: keys.anthropic ?? (isDev ? (process.env.ANTHROPIC_API_KEY ?? '') : ''),
    serpapi:   keys.serpapi   ?? (isDev ? (process.env.SERPAPI_API_KEY   ?? '') : ''),
    photoroom: keys.photoroom ?? (isDev ? (process.env.PHOTOROOM_API_KEY ?? '') : ''),
  }
}
```

- [ ] **Step 2.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/user-api-keys.ts
git commit -m "feat: add getUserApiKeys helper — per-user API keys with dev-only env fallback"
```

---

## Task 3: Pipeline step signatures

**Files:**
- Modify: `src/lib/pipeline/step1-product-id.ts`
- Modify: `src/lib/pipeline/step2-vision-analysis.ts`
- Modify: `src/lib/pipeline/step3-pricing-research.ts`
- Modify: `src/lib/pipeline/step4a-draft-listing.ts`
- Modify: `src/lib/pipeline/step4b-photoroom.ts`
- Modify: `src/lib/pipeline/step5-auth-plan.ts`

Add `import type { ApiKeys } from '@/lib/user-api-keys'` to each file. Add `apiKeys: ApiKeys` as the last parameter of each exported function. Replace `process.env.*` with `apiKeys.*`.

- [ ] **Step 3.1: Patch step1-product-id.ts**

Add import at top:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Change function signature from:
```typescript
export async function runStep1ProductId(
  listingId: string,
  photoUrl: string
): Promise<ProductIdData> {
```
to:
```typescript
export async function runStep1ProductId(
  listingId: string,
  photoUrl: string,
  apiKeys: ApiKeys
): Promise<ProductIdData> {
```

Replace:
```typescript
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)
```
with:
```typescript
  url.searchParams.set('api_key', apiKeys.serpapi)
```

- [ ] **Step 3.2: Patch step2-vision-analysis.ts**

Add import:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Change function signature from:
```typescript
export async function runStep2VisionAnalysis(
  listingId: string,
  photoUrl: string,
  step1: ProductIdData,
  corrections: string | null = null
): Promise<VisionAnalysis> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```
to:
```typescript
export async function runStep2VisionAnalysis(
  listingId: string,
  photoUrl: string,
  step1: ProductIdData,
  corrections: string | null = null,
  apiKeys: ApiKeys
): Promise<VisionAnalysis> {
  const client = new Anthropic({ apiKey: apiKeys.anthropic })
```

- [ ] **Step 3.3: Patch step3-pricing-research.ts**

Add import:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

The file has two inner async functions that call SerpAPI (`fetchSerpEbayComps` and `fetchSerpComps`). Add `apiKey: string` as their last parameter and thread the key through. Change `runStep3PricingResearch`:

Change function signature from:
```typescript
export async function runStep3PricingResearch(
  listingId: string,
  step2: VisionAnalysis,
  model: string
): Promise<void> {
```
to:
```typescript
export async function runStep3PricingResearch(
  listingId: string,
  step2: VisionAnalysis,
  model: string,
  apiKeys: ApiKeys
): Promise<void> {
```

For the two inner functions, read their current signatures and add `apiKey: string` as last param, replacing each `process.env.SERPAPI_API_KEY!` occurrence with `apiKey`. Then at the call sites inside `runStep3PricingResearch`, pass `apiKeys.serpapi`.

- [ ] **Step 3.4: Patch step4a-draft-listing.ts**

Add import:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Change function signature from:
```typescript
export async function runStep4aDraftListing(
  listingId: string,
  step2: VisionAnalysis,
  suggestedPriceCents: number | null
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```
to:
```typescript
export async function runStep4aDraftListing(
  listingId: string,
  step2: VisionAnalysis,
  suggestedPriceCents: number | null,
  apiKeys: ApiKeys
): Promise<void> {
  const client = new Anthropic({ apiKey: apiKeys.anthropic })
```

- [ ] **Step 3.5: Patch step4b-photoroom.ts**

Add import:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Change function signature from:
```typescript
export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string
): Promise<void> {
```
to:
```typescript
export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string,
  apiKeys: ApiKeys
): Promise<void> {
```

Replace:
```typescript
      'x-api-key': process.env.PHOTOROOM_API_KEY!,
```
with:
```typescript
      'x-api-key': apiKeys.photoroom,
```

- [ ] **Step 3.6: Patch step5-auth-plan.ts**

Add import:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Read the current function signature and add `apiKeys: ApiKeys` as last param. Replace `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` with `new Anthropic({ apiKey: apiKeys.anthropic })`.

- [ ] **Step 3.7: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors about callers passing wrong number of args — that's correct, callers are fixed in Task 4. If there are errors inside the step files themselves, fix them first. Caller errors are expected at this point.

- [ ] **Step 3.8: Commit**

```bash
git add src/lib/pipeline/step1-product-id.ts src/lib/pipeline/step2-vision-analysis.ts \
  src/lib/pipeline/step3-pricing-research.ts src/lib/pipeline/step4a-draft-listing.ts \
  src/lib/pipeline/step4b-photoroom.ts src/lib/pipeline/step5-auth-plan.ts
git commit -m "refactor: add apiKeys param to all pipeline steps — thread user keys instead of process.env"
```

---

## Task 4: Inngest orchestrators

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts`
- Modify: `src/lib/inngest/functions/retry-step.ts`

- [ ] **Step 4.1: Update intake-pipeline.ts**

Add import at top:
```typescript
import { getUserApiKeys } from '@/lib/user-api-keys'
```

After line `const intakePhotoId: string = photoRow?.id ?? ''` and before `const step1Result`, add:

```typescript
    const listingRow = await supabase
      .from('listings')
      .select('user_id')
      .eq('id', listingId)
      .single()

    const apiKeys = await step.run('fetch-api-keys', () =>
      getUserApiKeys(listingRow.data?.user_id as string | null)
    )
```

Then update every `step.run(...)` call to pass `apiKeys` as the last argument to each step function:

```typescript
    const step1Result = await step.run('product-id', () =>
      runStep1ProductId(listingId, photoUrl, apiKeys)
    )

    let step2Result = await step.run('vision-analysis', () =>
      runStep2VisionAnalysis(listingId, photoUrl, step1Result, null, apiKeys)
    )
    // ...
    step2Result = await step.run(`re-identify-${gateAttempt}`, () =>
      runStep2VisionAnalysis(listingId, photoUrl, step1Result, corrections, apiKeys)
    )
    // ...
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps, apiKeys)
    )
    // ...
    await Promise.all([
      step.run('draft-listing', () =>
        runStep4aDraftListing(listingId, step2Result, suggestedPriceCents, apiKeys)
      ),
      step.run('photoroom-process', () =>
        runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys)
      ),
    ])
    // ...
    await step.run('auth-plan', () =>
      runStep5AuthPlan(listingId, step2Result, suggestedPriceCents, apiKeys)
    )
```

- [ ] **Step 4.2: Update retry-step.ts**

Add import at top:
```typescript
import { getUserApiKeys } from '@/lib/user-api-keys'
```

The retry-step already fetches the listing. Update that query to also select `user_id`:

```typescript
    const { data: listing } = await supabase
      .from('listings')
      .select(
        'user_id, category, brand, condition, is_luxury, suggested_price_cents, intake_meta'
      )
      .eq('id', listingId)
      .single()
```

Then after the `if (!listing)` guard, add:

```typescript
    const apiKeys = await step.run('fetch-api-keys', () =>
      getUserApiKeys(listing.user_id as string | null)
    )
```

Then add `apiKeys` as last arg to each `runStep*` call in the retry branches:

```typescript
    if (stepNum === 3) {
      await step.run('retry-pricing-research', () =>
        runStep3PricingResearch(listingId, step2Partial as unknown as Parameters<typeof runStep3PricingResearch>[1], '', apiKeys)
      )
    } else if (stepNum === 4) {
      await Promise.all([
        step.run('retry-draft-listing', () =>
          runStep4aDraftListing(
            listingId,
            step2Partial as unknown as Parameters<typeof runStep4aDraftListing>[1],
            listing.suggested_price_cents as number | null,
            apiKeys
          )
        ),
        step.run('retry-photoroom', () =>
          runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId, apiKeys)
        ),
      ])
    } else if (stepNum === 5) {
      await step.run('retry-auth-plan', () =>
        runStep5AuthPlan(
          listingId,
          step2Partial as unknown as Parameters<typeof runStep5AuthPlan>[1],
          listing.suggested_price_cents as number | null,
          apiKeys
        )
      )
    }
```

- [ ] **Step 4.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors (or only agent/chat.ts caller errors, which are fixed in Task 5).

- [ ] **Step 4.4: Commit**

```bash
git add src/lib/inngest/functions/intake-pipeline.ts src/lib/inngest/functions/retry-step.ts
git commit -m "refactor: fetch user apiKeys in Inngest functions, thread to pipeline steps"
```

---

## Task 5: Agent chat refactor

**Files:**
- Modify: `src/lib/agent/chat.ts`
- Modify: `src/app/api/agent/[listingId]/route.ts`

- [ ] **Step 5.1: Update chat.ts**

Add import at top:
```typescript
import type { ApiKeys } from '@/lib/user-api-keys'
```

Remove the module-level `const client = new Anthropic(...)` line.

Change `streamAgentResponse` signature from:
```typescript
export async function streamAgentResponse(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void
): Promise<void> {
```
to:
```typescript
export async function streamAgentResponse(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void,
  apiKeys: ApiKeys
): Promise<void> {
```

Inside the function body, add at the top (before the while loop):
```typescript
  const client = new Anthropic({ apiKey: apiKeys.anthropic })
```

- [ ] **Step 5.2: Update agent route**

Read `src/app/api/agent/[listingId]/route.ts`. Make these changes:

Add imports at top:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getUserApiKeys } from '@/lib/user-api-keys'
```

In the `POST` handler, after `const { listingId } = await params`, add auth guard and key fetch:

```typescript
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKeys = await getUserApiKeys(user.id)
```

Change `streamAgentResponse` call to pass `apiKeys`:
```typescript
        await streamAgentResponse(listingId, message, (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }, apiKeys)
```

- [ ] **Step 5.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5.4: Commit**

```bash
git add src/lib/agent/chat.ts "src/app/api/agent/[listingId]/route.ts"
git commit -m "refactor: thread apiKeys through agent chat — auth guard + per-user Anthropic client"
```

---

## Task 6: Auth flow

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/auth/error/page.tsx`

- [ ] **Step 6.1: Create middleware**

Write `src/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl
  const isPublicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/inngest')

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

Note: `/api/inngest` is excluded from auth — Inngest uses its own signing key.

- [ ] **Step 6.2: Create login page**

Write `src/app/login/page.tsx`:

```typescript
'use client'

import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  async function signInWithGoogle() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-semibold text-gray-100">AI Listings</h1>
        <p className="text-sm text-gray-500">Sign in to continue</p>
        <button
          onClick={() => void signInWithGoogle()}
          className="px-6 py-3 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-3 mx-auto"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.3: Create auth callback route**

```bash
mkdir -p src/app/auth/callback
```

Write `src/app/auth/callback/route.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', request.url))
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return NextResponse.redirect(new URL('/auth/error?reason=exchange_failed', request.url))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_user', request.url))
  }

  const mode = process.env.REGISTRATION_MODE ?? 'open'
  const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (mode === 'whitelist' && !allowedEmails.includes(user.email ?? '')) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/auth/error?reason=not_allowed', request.url))
  }

  if (mode === 'closed') {
    const createdAt = new Date(user.created_at).getTime()
    const isNewUser = Date.now() - createdAt < 60_000
    if (isNewUser) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/auth/error?reason=closed', request.url))
    }
  }

  return NextResponse.redirect(new URL('/dashboard', origin))
}
```

- [ ] **Step 6.4: Create auth error page**

```bash
mkdir -p src/app/auth/error
```

Write `src/app/auth/error/page.tsx`:

```typescript
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams

  const messages: Record<string, string> = {
    not_allowed: 'Your email address is not on the allowed list.',
    closed: 'Registration is currently closed.',
    exchange_failed: 'Something went wrong during sign-in. Please try again.',
    no_code: 'Invalid sign-in link. Please try again.',
    no_user: 'Could not retrieve your account after sign-in. Please try again.',
  }

  const message = messages[reason ?? ''] ?? 'An unexpected error occurred during sign-in.'

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-4 max-w-sm px-6">
        <h1 className="text-xl font-semibold text-gray-100">Sign-in failed</h1>
        <p className="text-sm text-gray-500">{message}</p>
        <a href="/login" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
          Try again →
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6.6: Commit**

```bash
git add src/middleware.ts src/app/login/page.tsx src/app/auth/callback/route.ts src/app/auth/error/page.tsx
git commit -m "feat: add Google OAuth auth — middleware, login page, callback with registration gate, error page"
```

---

## Task 7: Upload route — auth guard + user_id

**Files:**
- Modify: `src/app/api/upload/route.ts`

- [ ] **Step 7.1: Add auth check and user_id to upload route**

Read `src/app/api/upload/route.ts`. Make these changes:

Add import at top:
```typescript
import { createClient } from '@/lib/supabase/server'
```

In the `POST` handler, after `const formData = await request.formData()`, add:

```typescript
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

In the listing insert, add `user_id: user.id`:

```typescript
  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .insert({ status: 'intake', pipeline_step: 0, pipeline_total: 5, user_id: user.id })
    .select('id')
    .single()
```

- [ ] **Step 7.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/app/api/upload/route.ts
git commit -m "feat: upload route — auth guard + set user_id on listing creation"
```

---

## Task 8: Remaining API route auth guards

**Files:**
- Modify: `src/app/api/studio-upload/route.ts`
- Modify: `src/app/api/listings/[id]/publish/route.ts`

- [ ] **Step 8.1: Add auth guard to studio-upload**

Read `src/app/api/studio-upload/route.ts`. Add import:
```typescript
import { createClient } from '@/lib/supabase/server'
```

At the top of `POST`, after the null check on `file` and `listingId`, add:
```typescript
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

- [ ] **Step 8.2: Add auth guard to publish route**

Read `src/app/api/listings/[id]/publish/route.ts`. It already imports `getSupabaseAdmin`. Add import:
```typescript
import { createClient } from '@/lib/supabase/server'
```

At the top of the `PATCH` handler, after `const { id } = await params`, add:
```typescript
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
```

- [ ] **Step 8.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8.4: Commit**

```bash
git add src/app/api/studio-upload/route.ts "src/app/api/listings/[id]/publish/route.ts"
git commit -m "feat: add auth guards to studio-upload and publish API routes"
```

---

## Task 9: Settings page

**Files:**
- Create: `src/app/api/settings/keys/route.ts`
- Create: `src/app/settings/api-keys/ApiKeyRow.tsx`
- Create: `src/app/settings/api-keys/page.tsx`

- [ ] **Step 9.1: Create settings API route**

```bash
mkdir -p src/app/api/settings/keys
```

Write `src/app/api/settings/keys/route.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'

const VALID_PROVIDERS = ['anthropic', 'serpapi', 'photoroom'] as const

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { provider?: unknown; api_key?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { provider, api_key } = body

  if (typeof provider !== 'string' || !(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    return Response.json({ error: 'provider must be one of: anthropic, serpapi, photoroom' }, { status: 400 })
  }

  if (typeof api_key !== 'string' || api_key.trim() === '') {
    return Response.json({ error: 'api_key must be a non-empty string' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_api_keys')
    .upsert(
      { user_id: user.id, provider, api_key: api_key.trim() },
      { onConflict: 'user_id,provider' }
    )

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 9.2: Create ApiKeyRow client component**

```bash
mkdir -p src/app/settings/api-keys
```

Write `src/app/settings/api-keys/ApiKeyRow.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

interface ApiKeyRowProps {
  provider: string
  label: string
  placeholder: string
  maskedValue: string | null
}

export function ApiKeyRow({ provider, label, placeholder, maskedValue }: ApiKeyRowProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!value.trim()) return
    setSaving(true)
    try {
      await fetch('/api/settings/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: value.trim() }),
      })
      setValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="w-28 flex-none">
        <p className="text-xs font-semibold text-gray-300">{label}</p>
        <p className="text-[10px] text-gray-600 font-mono mt-0.5">
          {maskedValue ?? 'Not set'}
        </p>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors font-mono"
      />
      <button
        onClick={() => void save()}
        disabled={!value.trim() || saving}
        className="flex-none flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {saved ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}
```

- [ ] **Step 9.3: Create settings page**

Write `src/app/settings/api-keys/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ApiKeyRow } from './ApiKeyRow'

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-api03-...' },
  { id: 'serpapi',   label: 'SerpAPI',   placeholder: 'serpapi key' },
  { id: 'photoroom', label: 'PhotoRoom', placeholder: 'photoroom key' },
] as const

export default async function ApiKeysPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: keyRows } = await supabase
    .from('user_api_keys')
    .select('provider, api_key')

  const keysMap = Object.fromEntries(
    (keyRows ?? []).map((r) => [r.provider, r.api_key as string])
  )

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">API Keys</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">API Keys</h1>
          <p className="text-xs text-gray-600 mt-1">
            Stored per-account. Used by the pipeline and agent chat.
            Keys are never returned to the browser after saving.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
          {PROVIDERS.map((p) => (
            <ApiKeyRow
              key={p.id}
              provider={p.id}
              label={p.label}
              placeholder={p.placeholder}
              maskedValue={keysMap[p.id] ? `••••••••${keysMap[p.id].slice(-4)}` : null}
            />
          ))}
        </div>

        <p className="text-[10px] text-gray-700">
          Paste a new key into the field and click Save to update. The masked hint
          shows the last 4 characters of the currently stored key.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 9.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 9.5: Commit**

```bash
git add src/app/api/settings/keys/route.ts src/app/settings/api-keys/ApiKeyRow.tsx src/app/settings/api-keys/page.tsx
git commit -m "feat: settings API keys page — view masked keys, save per provider"
```

---

## Task 10: Supabase OAuth config + seed + close issue

**Files:** None (manual steps + beads housekeeping)

- [ ] **Step 10.1: Configure Google OAuth in Supabase dashboard**

1. Go to Supabase dashboard → Authentication → Providers → Google
2. Enable the Google provider
3. Enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
4. Add redirect URL: `{your Vercel URL}/auth/callback` and `http://localhost:3000/auth/callback`
5. Save

- [ ] **Step 10.2: Add env vars**

Add to `.env.local` (and Vercel environment variables):
```
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
REGISTRATION_MODE=whitelist
ALLOWED_EMAILS=joeblackwaslike@gmail.com
```

- [ ] **Step 10.3: First login + seed**

1. Start the app: `npm run dev`
2. Navigate to `http://localhost:3000` — should redirect to `/login`
3. Click "Sign in with Google" and complete the OAuth flow
4. Confirm you land on `/dashboard`
5. In Supabase dashboard SQL editor, open `supabase/seed/001_owner_keys.sql`, replace the three placeholder strings with your actual keys, and run it
6. Navigate to `http://localhost:3000/settings/api-keys` — confirm masked values show for all three providers

- [ ] **Step 10.4: Smoke test**

- Upload a photo → confirm pipeline starts (listing appears with Processing badge)
- Open a listing workspace → send a message in agent chat → confirm response streams
- Open a listing's publish page → confirm Copy All works

- [ ] **Step 10.5: Close beads issue**

```bash
bd close ai-listings-s5y --reason="Auth implemented: Google OAuth with whitelist gate, user_id isolation on listings + child tables via RLS subquery, per-user API keys in user_api_keys table, pipeline + agent thread keys from DB, settings page at /settings/api-keys."
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|-------------|------|
| Google OAuth login | Task 6 |
| REGISTRATION_MODE gate (open/whitelist/closed) | Task 6 — callback route |
| Middleware session refresh + redirect | Task 6 — middleware |
| user_id on listings, owner RLS | Task 1 |
| Child table RLS via subquery | Task 1 |
| user_api_keys table | Task 1 |
| getUserApiKeys helper, dev-only env fallback | Task 2 |
| All 6 pipeline steps accept apiKeys | Task 3 |
| Inngest functions fetch + thread apiKeys | Task 4 |
| Agent chat uses per-user Anthropic key | Task 5 |
| Upload route sets user_id + auth guard | Task 7 |
| studio-upload + publish auth guards | Task 8 |
| Settings page — view masked, save | Task 9 |
| Seed script for existing keys | Task 10 |

**Type consistency:** `ApiKeys` defined in Task 2, imported by all step files in Task 3, Inngest functions in Task 4, chat.ts in Task 5 — same interface throughout. `getUserApiKeys(userId: string | null | undefined)` handles both null (transitional listings) and valid UUID.

**Placeholder check:** None found.

**eBay credentials:** `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` are app-level credentials — intentionally NOT in `user_api_keys`. They stay as env vars.
