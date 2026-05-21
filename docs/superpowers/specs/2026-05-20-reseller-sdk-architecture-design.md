# Reseller Platform SDK Architecture Design

**Date**: 2026-05-20
**Status**: Design

---

## Context

The ai-listings app currently publishes to eBay and Poshmark via a manual copy-paste workflow: Claude generates platform-specific fields, the user copies them into the platform's UI, then pastes the listing URL back. This is slow, error-prone, and doesn't scale to 6 platforms.

This spec defines a **unified platform SDK layer** that abstracts over all reseller platforms with a common interface, enabling:

1. **Direct listing creation** (v2 publishing) — no more copy-paste
2. **Automated pricing research** via each platform's native data
3. **Order sync** — pull orders/sales into the seller dashboard
4. **Notification discovery** — surface platform alerts without polling each site manually
5. **Message/DM sync** — respond to buyer messages from the seller dashboard
6. **MCP server** — expose all SDK capabilities as Claude tools

---

## Platforms in Scope

| Platform | API Access | Strategy |
|----------|-----------|----------|
| eBay | Full official REST API | `@hendt/ebay-api` wrapper |
| Poshmark | No official API | Reverse-engineered (SDK already exists at `/Users/joe/Documents/Playground/packages/poshmark-seller-sdk`) |
| Mercari | Partial (Shops GraphQL + reverse-eng) | Shops API + mobile traffic reverse-eng |
| Etsy | Full official REST API v3 | `@profplum700/etsy-v3-api-client` wrapper |
| mechmarket | Reddit API (OAuth) + Imgur API | `snoowrap` + `imgur` SDKs |
| TheRealReal | No API (read-only pricing) | Apify scraper API for sold comps |

---

## Unified Interface

Every platform adapter implements this interface. Methods that a platform can't support are noted in per-platform specs.

```typescript
// src/lib/platforms/types.ts

export interface PlatformListing {
  platform: string;
  platformId: string;
  url: string;
  title: string;
  price: number; // cents
  status: 'active' | 'sold' | 'removed' | 'draft';
  createdAt: Date;
  updatedAt: Date;
  raw: Record<string, unknown>; // platform-native response
}

export interface PlatformComp {
  platform: string;
  title: string;
  soldPrice: number; // cents
  condition: string;
  url: string;
  soldAt: Date | null;
}

export interface PlatformOrder {
  platform: string;
  orderId: string;
  listingId: string;
  buyerUsername: string;
  salePrice: number; // cents
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  createdAt: Date;
  shippingAddress?: string;
  trackingNumber?: string;
}

export interface PlatformNotification {
  platform: string;
  notificationId: string;
  type: 'offer' | 'order' | 'message' | 'question' | 'shipped' | 'other';
  title: string;
  preview: string;
  url?: string;
  read: boolean;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PlatformMessage {
  platform: string;
  threadId: string;
  messageId: string;
  from: string; // username
  body: string;
  sentAt: Date;
  read: boolean;
}

export interface PlatformThread {
  platform: string;
  threadId: string;
  withUser: string;
  lastMessage: PlatformMessage;
  unreadCount: number;
  listingId?: string;
}

export interface UnifiedListing {
  internalId: string; // our DB listing id
  title: string;
  description: string;
  price: number; // cents
  condition: string;
  category: string;
  brand: string;
  imageUrls: string[];
  platformFields: Record<string, unknown>; // platform-specific overrides
}

export interface TrackingInfo {
  carrier: string;
  trackingNumber: string;
}

export interface PlatformSDK {
  platform: string;

  // Pricing research
  searchSoldComps(query: string, options?: { limit?: number }): Promise<PlatformComp[]>;

  // Listing management
  createListing(listing: UnifiedListing): Promise<{ platformId: string; url: string }>;
  updateListing(platformId: string, updates: Partial<UnifiedListing>): Promise<void>;
  deleteListing(platformId: string): Promise<void>;
  getListing(platformId: string): Promise<PlatformListing>;
  getMyListings(filters?: { status?: string }): Promise<PlatformListing[]>;

  // Orders
  getOrders(since?: Date): Promise<PlatformOrder[]>;
  getOrder(orderId: string): Promise<PlatformOrder>;
  markShipped(orderId: string, tracking: TrackingInfo): Promise<void>;

  // Notifications
  getNotifications(since?: Date): Promise<PlatformNotification[]>;
  markNotificationRead(notificationId: string): Promise<void>;

  // Messaging
  getThreads(): Promise<PlatformThread[]>;
  getThread(threadId: string): Promise<PlatformMessage[]>;
  sendMessage(threadId: string, body: string): Promise<void>;
  replyToOffer?(offerId: string, action: 'accept' | 'decline' | 'counter', counterPrice?: number): Promise<void>;
}
```

---

## Directory Structure

```
src/lib/platforms/
├── types.ts                    # Unified interface (above)
├── index.ts                    # Platform registry + factory
├── adapters/
│   ├── ebay.ts                 # eBay adapter (wraps @hendt/ebay-api)
│   ├── poshmark.ts             # Poshmark adapter (wraps poshmark-seller-sdk)
│   ├── mercari.ts              # Mercari adapter
│   ├── etsy.ts                 # Etsy adapter (wraps etsy-v3 client)
│   ├── mechmarket.ts           # mechmarket adapter (snoowrap + imgur)
│   └── therealreal.ts          # TheRealReal read-only adapter (Apify)
├── credentials.ts              # Load platform creds from user_settings / user_api_keys
└── mcp-server.ts               # MCP server exposing all adapter methods as tools
```

---

## Credential Management

Platform credentials are stored in `user_api_keys` (for API keys/secrets) and `user_settings` (for typed config values like Reddit username).

```typescript
// src/lib/platforms/credentials.ts

export type PlatformCreds = {
  ebay: { clientId: string; clientSecret: string; refreshToken: string };
  poshmark: { sessionCookies: string };
  mercari: { accessToken: string; refreshToken: string };
  etsy: { clientId: string; accessToken: string; refreshToken: string };
  mechmarket: {
    redditClientId: string; redditClientSecret: string;
    redditRefreshToken: string; redditUsername: string;
    imgurClientId: string; imgurAccessToken: string; imgurRefreshToken: string;
    usState: string;
  };
  therealreal: { apifyApiKey: string };
};
```

---

## Publishing v2

Replace the copy-paste workflow with direct API calls.

```typescript
// src/app/api/listings/[id]/publish/route.ts (v2 flow)

// Current v1: PATCH { platform, listing_url } → user manually pasted URL
// New v2:     POST { platform } → app calls platform.createListing() → stores returned URL

async function publishToplatform(listingId: string, platform: string) {
  const listing = await getListingWithPlatformFields(listingId);
  const sdk = await getPlatformSDK(platform, listing.userId);
  const { platformId, url } = await sdk.createListing(toUnifiedListing(listing));
  await savePlatformUrl(listingId, platform, url);
  await savePlatformId(listingId, platform, platformId);
}
```

The UI changes: instead of copy fields + paste URL, the user clicks "Publish to eBay" and the app handles it. A loading state + success/error toast replaces the manual flow.

**DB addition**: `listing_platforms` table (tracks per-platform IDs for updates/sync):
```sql
CREATE TABLE listing_platforms (
  listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_id text NOT NULL,
  platform_url text,
  published_at timestamptz DEFAULT now(),
  PRIMARY KEY (listing_id, platform)
);
```

---

## MCP Server

Expose all SDK methods as MCP tools so Claude can call them directly during agent sessions.

```typescript
// src/lib/platforms/mcp-server.ts

// Tool: platform_search_comps
// Tool: platform_create_listing
// Tool: platform_get_orders
// Tool: platform_get_notifications
// Tool: platform_get_threads
// Tool: platform_send_message
// Tool: platform_mark_shipped
```

Each tool takes a `platform` parameter + method-specific args. Claude can use these during the agent chat to cross-list items, check for new orders, respond to buyers, etc.

---

## Polling + Real-time Sync (Inngest)

Background Inngest jobs sync platform data into local DB tables:

| Job | Cadence | Action |
|-----|---------|--------|
| `sync-platform-orders` | every 15 min | Calls `getOrders()` on all configured platforms, upserts to `orders` table |
| `sync-platform-notifications` | every 5 min | Calls `getNotifications()`, inserts new ones to `notifications` table |
| `sync-platform-messages` | every 5 min | Calls `getThreads()` + `getThread()` for unread, stores in `messages` table |

New data → Supabase realtime → frontend toast + notification panel update.

---

## Per-Platform Design Specs

- [mechmarket Integration](./2026-05-20-mechmarket-integration-design.md)
- [eBay Integration](./2026-05-20-ebay-integration-design.md)
- [Poshmark Integration](./2026-05-20-poshmark-integration-design.md)
- [Mercari Integration](./2026-05-20-mercari-integration-design.md)
- [Etsy Integration](./2026-05-20-etsy-integration-design.md)
- [TheRealReal Integration](./2026-05-20-therealreal-integration-design.md)
- [Core Features (non-platform)](./2026-05-20-core-features-design.md)
