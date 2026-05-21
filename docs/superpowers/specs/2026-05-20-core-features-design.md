# Core Features Design (Non-Platform)

**Date**: 2026-05-20
**Status**: Design

---

## Context

This spec covers all features and fixes that are not platform integrations. These are foundational changes that the platform integrations depend on, plus product expansion work.

---

## 0. Bug Fix: Supabase k8s Redirect (URGENT, Do First)

**Problem**: The production app at `https://ai-listings.napoleon-catfish.ts.net` redirects to hosted Supabase on login instead of the self-hosted k8s instance.

**Root cause candidates** (diagnose in order):

1. `NEXT_PUBLIC_SUPABASE_URL` in k8s ConfigMap pointing to `*.supabase.co` instead of `https://sup-ai-listings.napoleon-catfish.ts.net`
2. Supabase auth `SITE_URL` configured to cloud URL in the k8s Supabase instance settings
3. Auth callback redirect URLs in Supabase not including the k8s app URL

**Diagnosis commands**:
```bash
# Check ConfigMap
kubectl get configmap -n ai-listings ai-listings-config -o jsonpath='{.data}'

# Check Secret env vars
kubectl get secret -n ai-listings ai-listings-secret -o jsonpath='{.data}' | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  Object.entries(d).forEach(([k,v])=>console.log(k+'='+Buffer.from(v,'base64').toString()))"

# Check Supabase auth config table
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- \
  psql -U postgres -c "SELECT config_key, config_value FROM auth.flow_state LIMIT 1;"
# Or check auth.users table to confirm DB connectivity
kubectl exec -n sup-ai-listings ai-listings-supabase-db-0 -- \
  psql -U postgres -c "SELECT count(*) FROM auth.users;"
```

**Fix**: Update the ConfigMap `NEXT_PUBLIC_SUPABASE_URL` to `https://sup-ai-listings.napoleon-catfish.ts.net` and redeploy. Or fix the Supabase `SITE_URL` setting via the Supabase Studio dashboard at `https://sup-ai-listings.napoleon-catfish.ts.net`.

---

## 1. New Product Categories

### 1a. `watches`

**Files to modify**:

| File | Change |
|------|--------|
| [src/types/listings.ts](../../src/types/listings.ts) | Add `'watches'` to `ListingCategory` union; add `WA` to `CATEGORY_PREFIXES` |
| [src/lib/pipeline/step1-product-id.ts](../../src/lib/pipeline/step1-product-id.ts) | Add inference regex; add `WA` prefix mapping |
| [src/lib/pipeline/step2-vision-analysis.ts](../../src/lib/pipeline/step2-vision-analysis.ts) | Add `'watches'` to Claude tool enum; add to LUXURY_BRANDS; add photo plan hint |
| [src/lib/pipeline/step5-auth-plan.ts](../../src/lib/pipeline/step5-auth-plan.ts) | Add watch-specific auth steps |
| New migration | Category CHECK constraint + sku_counters |

**Inference regex**: `/watch|timepiece|movado|rolex|omega|seiko|casio|cartier.*watch|tudor|tag.?heuer|longines|hublot/i`

**LUXURY_BRANDS additions**: Movado, Rolex, Omega, Cartier, TAG Heuer, Hublot, Patek Philippe, IWC, Breguet, Jaeger-LeCoultre

**Photo plan hint**:
```
watches: front dial (full face), crown close-up, case back (serial number + movement if visible),
         band/bracelet + clasp, bezel detail, any scratches/chips on crystal, box and papers if present
```

**Auth plan steps** (for luxury watches when `isLuxury === true`):
- Confirm Museum dial authenticity markers (Movado: single dot at 12 o'clock position)
- Verify sapphire crystal (scratch test with knife — sapphire won't scratch)
- Locate and photograph case back serial number
- Check "Swiss Made" engraving on dial and case back
- Test crown functionality (pull to set time, wind if automatic)
- Note movement type (quartz vs. automatic)
- Check bracelet/band for stretch, missing links, clasp wear
- Include original box, papers, warranty card if available

### 1b. `keyboards`

**Files to modify**: Same list as watches.

**Inference regex**: `/mechanical.?keyboard|keyboard|keycap|switch.*keyboard|tkl|65%|75%|60%|40%|gmk|kbd|endgame.?gear|gmmk/i`

**Photo plan hint**:
```
keyboards: top-down full board, left side profile, right side profile, bottom (case + badge),
           PCB close-up if unbuilt/exposed, switch stem detail, keycap legends (angle shot),
           stabilizers, any scratches/damage, box and accessories included
```

No auth plan (not a luxury category).

### Database Migration

```sql
-- supabase/migrations/000X_add_watches_keyboards.sql

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_category_check;
ALTER TABLE listings ADD CONSTRAINT listings_category_check
  CHECK (category IN (
    'handbag','clothing','sneakers','electronics','jewelry',
    'collectibles','watches','keyboards','other'
  ));

INSERT INTO sku_counters (prefix, category, last_value)
  VALUES ('WA', 'watches', 0), ('KB', 'keyboards', 0)
  ON CONFLICT DO NOTHING;
```

---

## 2. Pricing Research Enhancements

### 2a. TheRealReal for Watches

No code change needed in step3 — the luxury Google Shopping search already targets `site:therealreal.com`. Adding Movado and other watch brands to LUXURY_BRANDS in step2 is sufficient.

Optionally: add Apify TRR adapter call for `watches` category (see TheRealReal integration spec).

### 2b. Reddit/mechmarket Comps for Keyboards

Add `fetchRedditMechmarketComps()` to step3:

```typescript
// src/lib/pipeline/step3-pricing-research.ts

async function fetchRedditMechmarketComps(brand: string, model: string): Promise<PricingComp[]> {
  // snoowrap search r/mechmarket for "[H] {model}" posts
  // Pass top 10–15 post titles+bodies to Claude for price extraction
  // Return array of { source: 'reddit', title, sale_price_cents, listing_url }
}
```

Run in parallel with eBay comps for `keyboards` category (both always run, results merged).

Add `'reddit'` to `pricing_comps.source` CHECK constraint in DB.

---

## 3. User Settings (Typed Key-Value Store)

Needed for platform credentials and user preferences.

### Migration

```sql
-- supabase/migrations/000X_add_user_settings.sql

CREATE TABLE user_settings (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value text,
  setting_type text NOT NULL DEFAULT 'string'
    CHECK (setting_type IN ('string', 'number', 'decimal', 'date', 'JSON', 'array', 'credential')),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, setting_key)
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);
```

### Usage

```typescript
// src/lib/user-settings.ts

export async function getSetting(userId: string, key: string): Promise<string | null>
export async function setSetting(userId: string, key: string, value: string, type?: SettingType): Promise<void>
export async function getSettings(userId: string, keys: string[]): Promise<Record<string, string>>
```

For `credential` type: values are stored as-is (plaintext in DB, protected by RLS). If enhanced security is needed, encrypt with a per-user key derived from their auth token.

### Settings UI

New component: `src/components/settings/PlatformSettings.tsx`

Sections:
- **mechmarket**: Reddit username, US state code
- **Imgur**: OAuth connect button (flow: app → Imgur OAuth → callback → store tokens)
- **Reddit**: OAuth connect button (app → Reddit OAuth → callback → store tokens)
- **Poshmark**: Paste cookie string field (with instructions link)
- **Mercari**: API token field
- **Etsy**: OAuth connect button
- **eBay**: OAuth connect button
- **TheRealReal**: Apify API token field

---

## 4. Notification System

Facebook-style notification center in the seller dashboard.

### Database

```sql
-- supabase/migrations/000X_add_notifications.sql

CREATE TABLE notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'reddit_message', 'offer_received', 'order_placed', 'item_sold',
    'listing_question', 'timestamp_warning', 'cooldown_expired',
    'auth_required', 'shipping_reminder', 'other'
  )),
  platform text,                -- 'ebay', 'poshmark', 'mechmarket', etc. (nullable)
  title text NOT NULL,          -- e.g. "New offer on Air Jordan 1"
  preview text,                 -- Short preview text (1-2 sentences)
  source_url text,              -- Link to the notification source (listing, thread, etc.)
  related_listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}',  -- Full platform payload
  read_at timestamptz,          -- NULL = unread
  created_at timestamptz DEFAULT now()
);

CREATE INDEX notifications_user_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own notifications" ON notifications
  FOR ALL USING (auth.uid() = user_id);
```

### UI Components

#### Bell Icon + Badge

In the main navbar (wherever the existing nav is):

```tsx
// src/components/layout/NotificationBell.tsx
// - Shows bell icon
// - Unread count badge (red circle, number) when unread > 0
// - Clicking opens NotificationPanel (slide-in panel or dropdown)
// - Supabase realtime subscription: INSERT on notifications WHERE read_at IS NULL
//   → increment badge count in real-time
```

#### Notification Panel

```tsx
// src/components/layout/NotificationPanel.tsx
// - Renders as a dropdown/slide-in panel anchored to the bell icon
// - List of all notifications, sorted by created_at DESC
// - Each row:
//   - [Platform icon] | [Title] | [Time ago: "2h", "3d", etc.]
//   - [Preview text snippet]
//   - Unread = bold + light blue left border; Read = normal weight
// - "Mark all as read" button at top right
// - Clicking a notification:
//   - If type === 'reddit_message' or 'listing_question': open MessageThread panel
//   - Otherwise: navigate to source_url or related listing
//   - Mark as read (PATCH notifications/{id})
```

#### Message Thread Panel

```tsx
// src/components/messaging/MessageThreadPanel.tsx
// - Slide-in panel showing full message thread
// - Message bubbles (buyer = left, seller = right)
// - Reply text area + Send button
// - Platform badge showing which platform the message is from
// - "View on [Platform]" link
```

### Toast Notifications

For real-time new messages:

```tsx
// src/components/layout/NotificationToast.tsx
// - Supabase realtime subscription on notifications (INSERT events)
// - New notification → show toast in top-right corner
// - Toast shows: platform icon, title, preview (first 80 chars)
// - Auto-dismiss after 5 seconds
// - Clicking toast: same action as clicking the notification row
```

### Inngest Polling Jobs

```typescript
// src/inngest/functions/poll-platform-notifications.ts
// Runs every 5 minutes
// For each configured platform:
//   1. Call adapter.getNotifications(since: lastPollTime)
//   2. Filter out already-seen notification IDs
//   3. Insert new ones to notifications table
//   4. Supabase realtime fires → toast + badge update in UI

// src/inngest/functions/poll-platform-messages.ts
// Runs every 5 minutes
// For each platform:
//   1. Call adapter.getThreads() → find unread threads
//   2. For each unread thread: call adapter.getThread(threadId)
//   3. Upsert messages to a messages table
//   4. Insert 'reddit_message' / 'listing_question' notification if new message

// src/inngest/functions/sync-platform-orders.ts
// Runs every 15 minutes
// For each platform:
//   1. Call adapter.getOrders(since: lastSyncTime)
//   2. Upsert to orders table
//   3. Insert 'order_placed' or 'item_sold' notification for new orders
```

---

## 5. Messages Table

```sql
-- supabase/migrations/000X_add_messages.sql

CREATE TABLE messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  thread_id text NOT NULL,
  message_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_username text NOT NULL,
  body text NOT NULL,
  related_listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL,
  read_at timestamptz,
  metadata jsonb DEFAULT '{}',
  UNIQUE (platform, message_id)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own messages" ON messages
  FOR ALL USING (auth.uid() = user_id);
```

---

## 6. Listing Platforms Table

Tracks per-platform listing IDs for the v2 publishing flow.

```sql
-- supabase/migrations/000X_add_listing_platforms.sql

CREATE TABLE listing_platforms (
  listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_id text NOT NULL,
  platform_url text,
  published_at timestamptz DEFAULT now(),
  last_synced_at timestamptz,
  sync_status text DEFAULT 'ok' CHECK (sync_status IN ('ok', 'error', 'stale')),
  PRIMARY KEY (listing_id, platform)
);
```

---

## 7. Verification

1. **Supabase redirect bug**: Login to `https://ai-listings.napoleon-catfish.ts.net` → should stay on k8s Supabase (no redirect to supabase.co)
2. **Product types**: Upload Movado watch photo → category = `watches`, `isLuxury = true`, pricing comps include TRR sources
3. **Keyboard comps**: Upload keyboard photo → pricing_comps table includes `source = 'reddit'` entries
4. **User settings**: Set `reddit_username = 'testuser'`, `us_state = 'NY'` → retrieve them back correctly
5. **Notification bell**: Insert a notification row directly in DB → badge count increments in real-time
6. **Toast**: Insert notification → toast appears within 1 second
7. **Message panel**: Click message notification → MessageThreadPanel opens with correct thread
8. **Mark read**: Click notification → `read_at` updates, notification loses bold styling
