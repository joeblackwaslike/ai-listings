# AI Listings — Sub-plan 1: Project Scaffold

> **Master plan:** `docs/MASTER-PLAN.md` — start here if you need context on the full project or what comes next.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a working Next.js 15 + Supabase + Inngest project with full database schema, typed client setup, a skeleton intake pipeline function, and a smoke-testable dev environment.

**Architecture:** Next.js App Router on Vercel; Supabase for Postgres + Storage + Realtime; Inngest for durable background pipelines. All domain types are centralized in `src/types/listings.ts` and referenced throughout — no per-file type redefinition.

**Tech Stack:** Next.js 15 (App Router, Turbopack), TypeScript 5, Supabase (`@supabase/supabase-js` + `@supabase/ssr`), Inngest, Tailwind CSS.

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/types/listings.ts` | All domain TypeScript types — single source of truth |
| `src/lib/supabase/client.ts` | Browser Supabase client (memoized singleton) |
| `src/lib/supabase/server.ts` | Server Supabase client (cookie-based, for RSC + Server Actions) |
| `src/lib/inngest/client.ts` | Inngest client (event schemas + singleton) |
| `src/lib/inngest/functions/intake-pipeline.ts` | Skeleton intake pipeline Inngest function |
| `src/app/api/inngest/route.ts` | Inngest serve handler — registers all functions |
| `src/app/layout.tsx` | Root layout — fonts, Tailwind base, metadata |
| `src/app/page.tsx` | Root redirect → `/dashboard` |
| `src/app/dashboard/page.tsx` | Dashboard placeholder |
| `src/app/listings/[id]/page.tsx` | Workspace placeholder |
| `supabase/migrations/0001_initial_schema.sql` | Full schema: all 4 tables, SKU counter, RLS policies |
| `.env.local.example` | All required credentials, documented |
| `.gitignore` | Add `.env.local`, `.superpowers/` |

---

## Task 1: Bootstrap Next.js project

**Files:**
- Create: project root (via `create-next-app`)
- Modify: `package.json` (add Supabase + Inngest deps)
- Modify: `.gitignore`

- [ ] **Step 1.1: Run create-next-app**

From the `ai-listings/` directory (which already has `CLAUDE.md` and `docs/`), bootstrap in-place:

```bash
cd /path/to/ai-listings
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --turbopack --no-git --import-alias "@/*"
```

When prompted:
- Would you like to use `src/` directory? **Yes** (already flagged)
- Would you like to customize import alias? **No** (already set to `@/*`)

- [ ] **Step 1.2: Install additional dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr inngest zod
```

- [ ] **Step 1.3: Add entries to `.gitignore`**

Append to the generated `.gitignore`:

```
# Local env
.env.local

# Brainstorm / plan artifacts
.superpowers/
```

- [ ] **Step 1.4: Create `.env.local.example`**

```bash
# Supabase — create a DEDICATED project at supabase.com (do not share with other apps)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic — API billing account (separate from Claude Code subscription)
# Sign up: console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# SerpAPI — Google Lens + cross-platform pricing
# Sign up: serpapi.com
SERPAPI_API_KEY=...

# Apify — eBay sold/completed listings MCP
# Sign up: apify.com
APIFY_TOKEN=apify_api_...

# eBay developer account + app keys
# Sign up: developer.ebay.com
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
# Optional — higher rate limits
EBAY_USER_REFRESH_TOKEN=...

# PhotoRoom API — background removal + staging
# Sign up: photoroom.com/api
PHOTOROOM_API_KEY=...

# Inngest — check app.inngest.com for existing account first
INNGEST_SIGNING_KEY=signkey-...
INNGEST_EVENT_KEY=...
```

- [ ] **Step 1.5: Copy example to local**

```bash
cp .env.local.example .env.local
# Fill in real credentials before running the dev server
```

- [ ] **Step 1.6: Verify build compiles clean**

```bash
npm run build
```

Expected: `✓ Compiled successfully` (the generated Next.js app should compile out of the box)

- [ ] **Step 1.7: Commit**

```bash
git init
git add .
git commit -m "feat: bootstrap Next.js 15 project with Supabase + Inngest deps"
```

---

## Task 2: Domain types

**Files:**
- Create: `src/types/listings.ts`

- [ ] **Step 2.1: Write `src/types/listings.ts`**

```typescript
// All domain types for the AI Listings platform.
// These are the authoritative TypeScript types — they mirror the Postgres schema.
// PRD: docs/superpowers/specs/2026-04-22-ai-listings-prd.md

export type ListingStatus =
  | 'intake'
  | 'id_gate'
  | 'in_loop'
  | 'finalizing'
  | 'published'
  | 'archived';

export type ListingCategory =
  | 'handbag'
  | 'clothing'
  | 'sneakers'
  | 'electronics'
  | 'jewelry'
  | 'collectibles'
  | 'other';

export type ConditionValue =
  | 'new_with_tags'
  | 'new_without_tags'
  | 'like_new'
  | 'very_good'
  | 'good'
  | 'fair'
  | 'poor'
  | 'for_parts';

export type PhotoType = 'intake' | 'processed' | 'auth_card' | 'studio';

export type CompSource = 'ebay' | 'poshmark' | 'therealreal' | 'google';

export type ConversationRole = 'user' | 'assistant';

// SKU prefix per category — HB-0042 format
export const CATEGORY_PREFIXES: Record<ListingCategory, string> = {
  handbag: 'HB',
  clothing: 'CL',
  sneakers: 'SN',
  electronics: 'EL',
  jewelry: 'JW',
  collectibles: 'CO',
  other: 'OT',
};

export interface Inclusion {
  item: string;
  included: boolean;
  notes: string | null;
}

export interface AuthStep {
  step: string;
  guidance: string;
  status: 'pending' | 'done' | 'failed';
  photo_required: boolean;
}

export interface PhotoShot {
  shot: string;
  description: string;
  required: boolean;
  photo_type: PhotoType;
}

export interface PlatformFields {
  ebay?: {
    title: string;
    category_id: string;
    item_specifics: Record<string, string>;
    condition_id: string;
    description: string;
  };
  poshmark?: {
    title: string;
    category: string;
    size: string;
    description: string;
    original_price?: number;
  };
  [platform: string]: Record<string, unknown> | undefined;
}

export interface ListingUrls {
  ebay?: string;
  poshmark?: string;
  mercari?: string;
  [platform: string]: string | undefined;
}

export interface Listing {
  id: string;
  sku: string | null;

  status: ListingStatus;
  pipeline_step: number;
  pipeline_total: number;

  title: string | null;
  description: string | null;
  category: ListingCategory | null;
  brand: string | null;
  condition: ConditionValue | null;
  condition_notes: string | null;
  tags: string[];
  inclusions: Inclusion[];

  suggested_price_cents: number | null;
  final_price_cents: number | null;
  confidence_score: number | null;

  auth_plan: AuthStep[];
  photo_plan: PhotoShot[];
  platform_fields: PlatformFields;
  listing_urls: ListingUrls;

  agent_blocked: boolean;
  agent_blocked_reason: string | null;

  is_luxury: boolean;
  intake_meta: Record<string, unknown> | null;

  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  listing_id: string;
  type: PhotoType;
  raw_url: string;
  processed_url: string | null;
  display_order: number;
  photoroom_meta: Record<string, unknown> | null;
  created_at: string;
}

export interface PricingComp {
  id: string;
  listing_id: string;
  source: CompSource;
  title: string;
  sale_price_cents: number;
  condition: string;
  sold_at: string;
  listing_url: string;
  condition_delta: 'same' | 'better' | 'worse';
  adjusted_price_cents: number;
  created_at: string;
}

export interface Conversation {
  id: string;
  listing_id: string;
  role: ConversationRole;
  content: string;
  context_snapshot: Record<string, unknown> | null;
  created_at: string;
}

// ---- Agent tool return types (thick tools pattern) ----
// See docs/thick-tools-pattern.md

export interface PricingResearch {
  ok: true;
  suggestedPrice: number;
  confidence: number;
  confidenceSummary: string;
  comps: Array<{
    source: string;
    title: string;
    price: number;
    condition: string;
    conditionDelta: 'same' | 'better' | 'worse';
    adjustedPrice: number;
    soldDaysAgo: number;
    url: string;
  }>;
  evidence: string;
}

export interface AuthChecklist {
  ok: true;
  passed: boolean;
  confidence: 'high' | 'medium' | 'low';
  steps: Array<{
    step: string;
    guidance: string;
    status: 'pending' | 'done' | 'failed';
    photoRequired: boolean;
  }>;
  platformAuth: {
    eligible: boolean;
    platform: 'ebay' | 'poshmark' | null;
    threshold: number;
    note: string;
  };
}

export interface ListingDescription {
  ok: true;
  canonical: string;
  seoKeywords: string[];
  platforms: Array<{
    platform: 'ebay' | 'poshmark';
    title: string;
    description: string;
    characterCount: number;
  }>;
}

export type AgentToolError = { ok: false; reason: string };

export type PricingResearchResult = PricingResearch | AgentToolError;
export type AuthChecklistResult = AuthChecklist | AgentToolError;
export type ListingDescriptionResult = ListingDescription | AgentToolError;
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.3: Commit**

```bash
git add src/types/listings.ts
git commit -m "feat: add domain TypeScript types for listings, photos, comps, conversations"
```

---

## Task 3: Supabase schema migration

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`

- [ ] **Step 3.1: Install Supabase CLI (if not already installed)**

```bash
brew install supabase/tap/supabase
supabase --version
```

Expected: `1.x.x` or higher

- [ ] **Step 3.2: Init Supabase in the project**

```bash
supabase init
```

This creates `supabase/` directory with config.

- [ ] **Step 3.3: Create migration file**

Create `supabase/migrations/0001_initial_schema.sql`:

```sql
-- AI Listings Platform — Initial Schema
-- Mirrors: src/types/listings.ts
-- PRD: docs/superpowers/specs/2026-04-22-ai-listings-prd.md

-- ──────────────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────
-- SKU generation
-- ──────────────────────────────────────────────────────────────────
-- One row per category prefix. Incremented atomically when a SKU is assigned.
create table sku_counters (
  category_prefix text primary key,
  next_value      integer not null default 1
);

insert into sku_counters (category_prefix) values
  ('HB'), ('CL'), ('SN'), ('EL'), ('JW'), ('CO'), ('OT');

-- Returns the next SKU for a given prefix (e.g. 'HB' → 'HB-0001').
-- Atomically increments the counter. Safe under concurrent writes.
create or replace function generate_sku(prefix text)
returns text
language plpgsql
as $$
declare
  seq integer;
begin
  update sku_counters
    set next_value = next_value + 1
    where category_prefix = prefix
    returning next_value - 1 into seq;

  if not found then
    raise exception 'Unknown SKU prefix: %', prefix;
  end if;

  return prefix || '-' || lpad(seq::text, 4, '0');
end;
$$;

-- ──────────────────────────────────────────────────────────────────
-- listings
-- ──────────────────────────────────────────────────────────────────
create table listings (
  id                    uuid primary key default uuid_generate_v4(),
  sku                   text unique,                       -- null until Step 1 determines category

  -- Status
  status                text not null default 'intake'
                          check (status in ('intake','id_gate','in_loop','finalizing','published','archived')),
  pipeline_step         integer not null default 0,
  pipeline_total        integer not null default 5,        -- 5 for luxury, 4 for non-luxury; updated by pipeline

  -- Core fields
  title                 text,
  description           text,
  category              text
                          check (category in ('handbag','clothing','sneakers','electronics','jewelry','collectibles','other')),
  brand                 text,
  condition             text
                          check (condition in (
                            'new_with_tags','new_without_tags','like_new',
                            'very_good','good','fair','poor','for_parts'
                          )),
  condition_notes       text,
  tags                  text[] not null default '{}',
  inclusions            jsonb not null default '[]',       -- Inclusion[]

  -- Pricing
  suggested_price_cents integer,
  final_price_cents     integer,
  confidence_score      integer check (confidence_score between 0 and 100),

  -- Plans
  auth_plan             jsonb not null default '[]',       -- AuthStep[]
  photo_plan            jsonb not null default '[]',       -- PhotoShot[]

  -- Platform
  platform_fields       jsonb not null default '{}',       -- PlatformFields
  listing_urls          jsonb not null default '{}',       -- ListingUrls

  -- Agent
  agent_blocked         boolean not null default false,
  agent_blocked_reason  text,

  -- Meta
  is_luxury             boolean not null default false,
  intake_meta           jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_updated_at
  before update on listings
  for each row execute function set_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- photos
-- ──────────────────────────────────────────────────────────────────
create table photos (
  id              uuid primary key default uuid_generate_v4(),
  listing_id      uuid not null references listings(id) on delete cascade,
  type            text not null check (type in ('intake','processed','auth_card','studio')),
  raw_url         text not null,
  processed_url   text,
  display_order   integer not null default 0,
  photoroom_meta  jsonb,
  created_at      timestamptz not null default now()
);

create index photos_listing_id_idx on photos(listing_id);

-- ──────────────────────────────────────────────────────────────────
-- pricing_comps
-- ──────────────────────────────────────────────────────────────────
create table pricing_comps (
  id                    uuid primary key default uuid_generate_v4(),
  listing_id            uuid not null references listings(id) on delete cascade,
  source                text not null check (source in ('ebay','poshmark','therealreal','google')),
  title                 text not null,
  sale_price_cents      integer not null,
  condition             text not null,
  sold_at               date,
  listing_url           text not null,
  condition_delta       text not null check (condition_delta in ('same','better','worse')),
  adjusted_price_cents  integer not null,
  created_at            timestamptz not null default now()
);

create index pricing_comps_listing_id_idx on pricing_comps(listing_id);

-- ──────────────────────────────────────────────────────────────────
-- conversations
-- ──────────────────────────────────────────────────────────────────
create table conversations (
  id                uuid primary key default uuid_generate_v4(),
  listing_id        uuid not null references listings(id) on delete cascade,
  role              text not null check (role in ('user','assistant')),
  content           text not null,
  context_snapshot  jsonb,
  created_at        timestamptz not null default now()
);

create index conversations_listing_id_idx on conversations(listing_id);

-- ──────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ──────────────────────────────────────────────────────────────────
-- Phase 1: single-user app. RLS enables the anon key to be safe.
-- We use the service role key server-side (bypasses RLS as needed).

alter table listings enable row level security;
alter table photos enable row level security;
alter table pricing_comps enable row level security;
alter table conversations enable row level security;

-- For now: authenticated users see all rows (single-user app, Supabase Auth handles identity)
create policy "authenticated_full_access" on listings
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on photos
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on pricing_comps
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on conversations
  for all to authenticated using (true) with check (true);

-- ──────────────────────────────────────────────────────────────────
-- Supabase Realtime
-- ──────────────────────────────────────────────────────────────────
-- Enable Realtime on listings so the dashboard updates live
alter publication supabase_realtime add table listings;
```

- [ ] **Step 3.4: Link to your Supabase project**

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# Get project ref from: https://supabase.com/dashboard → your project → Settings → General
```

- [ ] **Step 3.5: Apply migration**

```bash
supabase db push
```

Expected: `Migrations applied successfully`

- [ ] **Step 3.6: Smoke-test the schema**

```bash
supabase db execute --command "select generate_sku('HB');"
```

Expected: `HB-0001`

```bash
supabase db execute --command "select generate_sku('HB');"
```

Expected: `HB-0002` (counter increments)

- [ ] **Step 3.7: Verify tables exist**

```bash
supabase db execute --command "\dt"
```

Expected: `conversations`, `listings`, `photos`, `pricing_comps`, `sku_counters` all listed

- [ ] **Step 3.8: Commit**

```bash
git add supabase/
git commit -m "feat: add initial Postgres schema — listings, photos, pricing_comps, conversations, SKU counters"
```

---

## Task 4: Supabase client setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`

- [ ] **Step 4.1: Create browser client — `src/lib/supabase/client.ts`**

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4.2: Create server client — `src/lib/supabase/server.ts`**

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookie writes ignored safely
          }
        },
      },
    }
  )
}
```

- [ ] **Step 4.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4.4: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat: add Supabase browser and server clients"
```

---

## Task 5: Inngest client + skeleton intake pipeline

**Files:**
- Create: `src/lib/inngest/client.ts`
- Create: `src/lib/inngest/functions/intake-pipeline.ts`
- Create: `src/app/api/inngest/route.ts`

- [ ] **Step 5.1: Create Inngest client — `src/lib/inngest/client.ts`**

```typescript
import { EventSchemas, Inngest } from 'inngest'

// Typed event schemas for all Inngest events in this app
type Events = {
  'photo/uploaded': {
    data: {
      listingId: string
      photoUrl: string
      uploadedAt: string
    }
  }
  'pipeline/retry-step': {
    data: {
      listingId: string
      step: number
    }
  }
}

export const inngest = new Inngest({
  id: 'ai-listings',
  schemas: new EventSchemas().fromRecord<Events>(),
})
```

- [ ] **Step 5.2: Create skeleton intake pipeline — `src/lib/inngest/functions/intake-pipeline.ts`**

```typescript
import { inngest } from '../client'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Supabase admin client (service role) used inside Inngest functions.
// Bypasses RLS — only use server-side where the caller is trusted.
function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const intakePipeline = inngest.createFunction(
  {
    id: 'intake-pipeline',
    name: 'Intake Pipeline',
    retries: 3,
  },
  { event: 'photo/uploaded' },
  async ({ event, step }) => {
    const { listingId } = event.data

    // Step 1 — Product ID (SerpAPI / Google Lens)
    // Implemented in sub-plan 2: Intake Pipeline
    const step1Result = await step.run('product-id', async () => {
      // TODO (sub-plan 2): call SerpAPI Google Lens, extract product metadata,
      // determine category, assign SKU, update listing status to 'id_gate'
      return { ok: true, listingId, step: 1 }
    })

    // Step 2 — Vision analysis + photo plan (Claude)
    // Implemented in sub-plan 2
    await step.run('vision-analysis', async () => {
      // TODO (sub-plan 2): Claude vision call — brand, condition, features, photo plan
      return { ok: true, step: 2 }
    })

    // Step 3 — Pricing research
    // Implemented in sub-plan 2
    await step.run('pricing-research', async () => {
      // TODO (sub-plan 2): eBay Apify comps + SerpAPI cross-platform
      return { ok: true, step: 3 }
    })

    // Steps 4a + 4b — Draft listing + image processing (parallel)
    // Implemented in sub-plan 2
    await step.run('draft-and-process', async () => {
      // TODO (sub-plan 2): Claude draft + PhotoRoom (in parallel)
      return { ok: true, step: 4 }
    })

    // Step 5 — Auth plan (conditional, luxury items only)
    // Implemented in sub-plan 2
    await step.run('auth-plan', async () => {
      // TODO (sub-plan 2): Claude auth plan generation
      return { ok: true, step: 5 }
    })

    // Mark listing as in_loop after all steps
    const supabase = getSupabaseAdmin()
    await supabase
      .from('listings')
      .update({ status: 'in_loop' })
      .eq('id', listingId)

    return { ok: true, listingId, status: 'in_loop' }
  }
)
```

- [ ] **Step 5.3: Create Inngest serve handler — `src/app/api/inngest/route.ts`**

```typescript
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [intakePipeline],
})
```

- [ ] **Step 5.4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/inngest/ src/app/api/inngest/
git commit -m "feat: add Inngest client, skeleton intake pipeline function, and serve handler"
```

---

## Task 6: App shell — layout + placeholder pages

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/listings/[id]/page.tsx`

- [ ] **Step 6.1: Update root layout — `src/app/layout.tsx`**

```typescript
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Listings',
  description: 'AI-powered resale listing platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-gray-950 text-gray-100 antialiased`}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 6.2: Root page redirect — `src/app/page.tsx`**

```typescript
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/dashboard')
}
```

- [ ] **Step 6.3: Dashboard placeholder — `src/app/dashboard/page.tsx`**

```typescript
export default function DashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-2">AI Listings</h1>
      <p className="text-gray-400 text-sm">
        Dashboard — implemented in sub-plan 4
      </p>
    </main>
  )
}
```

- [ ] **Step 6.4: Workspace placeholder — `src/app/listings/[id]/page.tsx`**

```typescript
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-2">Listing {id}</h1>
      <p className="text-gray-400 text-sm">
        Workspace — implemented in sub-plan 4
      </p>
    </main>
  )
}
```

- [ ] **Step 6.5: Verify build**

```bash
npm run build
```

Expected: `✓ Compiled successfully`, routes `/`, `/dashboard`, `/listings/[id]` all shown

- [ ] **Step 6.6: Commit**

```bash
git add src/app/
git commit -m "feat: add app shell — root redirect, dashboard placeholder, workspace placeholder"
```

---

## Task 7: Smoke test — full dev environment up

**Goal:** Verify the full dev stack runs: Next.js serves pages, Inngest dev runner connects, sending a test event creates a listing record and runs the skeleton function.

- [ ] **Step 7.1: Fill in `.env.local` with real Supabase credentials**

At minimum: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

All other credentials can be left as placeholders for now — the skeleton function doesn't call them.

- [ ] **Step 7.2: Start Next.js dev server**

```bash
npm run dev
```

Expected: `▲ Next.js 15.x.x` ready at `http://localhost:3000`

- [ ] **Step 7.3: Verify redirect works**

Open `http://localhost:3000` in a browser.

Expected: redirected to `http://localhost:3000/dashboard` showing "AI Listings" heading

- [ ] **Step 7.4: Start Inngest dev server (separate terminal)**

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Expected: Inngest dev console at `http://localhost:8288` with `intake-pipeline` function registered

If the function doesn't appear, check that `http://localhost:3000/api/inngest` responds to GET:

```bash
curl http://localhost:3000/api/inngest
```

Expected: JSON with `{ "message": "Inngest endpoint configured correctly" }` (or similar)

- [ ] **Step 7.5: Insert a test listing directly in Supabase**

In the Supabase dashboard → Table Editor → `listings`, or via CLI:

```bash
supabase db execute --command "
  insert into listings (status, pipeline_step, pipeline_total)
  values ('intake', 0, 5)
  returning id;
"
```

Note the returned `id` (e.g. `abc-123-...`).

- [ ] **Step 7.6: Send a `photo/uploaded` event via Inngest dev console**

In the Inngest dev console (`http://localhost:8288`) → Events → Send Event:

```json
{
  "name": "photo/uploaded",
  "data": {
    "listingId": "<id from step 7.5>",
    "photoUrl": "https://example.com/test-photo.jpg",
    "uploadedAt": "2026-04-22T12:00:00Z"
  }
}
```

- [ ] **Step 7.7: Verify function ran and listing is updated**

In the Inngest dev console → Functions → `intake-pipeline` → most recent run.

Expected: all 5 steps show `Completed` in green. The function tree shows each `step.run()` block succeeded.

In Supabase → `listings` table:

```bash
supabase db execute --command "
  select id, status, updated_at from listings order by created_at desc limit 1;
"
```

Expected: `status = 'in_loop'` (the final update from the skeleton function)

- [ ] **Step 7.8: Final commit**

```bash
git add .
git commit -m "chore: smoke test passed — skeleton pipeline runs end-to-end"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered by |
|-----------------|------------|
| Next.js App Router setup | Task 1 |
| Supabase schema — all 4 tables | Task 3 |
| SKU counter + generate_sku() | Task 3 |
| `id_gate` status (PRD delta from design spec) | Task 3 schema, Task 2 types |
| `pipeline_step` / `pipeline_total` columns | Task 3 schema, Task 2 types |
| `listing_urls` JSONB (replaces separate URL columns) | Task 3 schema, Task 2 types |
| `condition_notes` free-form field | Task 3 schema, Task 2 types |
| `tags` string[] | Task 3 schema, Task 2 types |
| Supabase Realtime enabled on `listings` | Task 3 (`alter publication`) |
| RLS policies | Task 3 |
| Inngest client + event types | Task 5 |
| Skeleton intake pipeline (5 steps stubbed) | Task 5 |
| Inngest serve handler at `/api/inngest` | Task 5 |
| All credential env vars documented | Task 1 |
| `.superpowers/` in `.gitignore` | Task 1 |

### Placeholder scan

No TBD, TODO (beyond the intentional sub-plan-2 TODOs inside the skeleton function which are correct), or "implement later" patterns. Every step has the exact code the engineer needs.

### Type consistency

- `ListingStatus` in `src/types/listings.ts` includes `'id_gate'` — matched in SQL `check` constraint.
- `CATEGORY_PREFIXES` maps every `ListingCategory` value to a prefix — used by `generate_sku()`.
- `AuthStep.status` uses `'pending' | 'done' | 'failed'` — consistent with `AuthChecklist.steps[].status` in agent tool types.
- `getSupabaseAdmin()` in `intake-pipeline.ts` uses `SUPABASE_SERVICE_ROLE_KEY` — matches `.env.local.example`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-scaffold.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
→ Use `superpowers:subagent-driven-development`

**2. Inline Execution** — Execute tasks in this session using the executing-plans skill, batch with checkpoints
→ Use `superpowers:executing-plans`

Which approach?
