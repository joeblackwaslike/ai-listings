# Poshmark Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

Poshmark has no official public API. The integration relies on the unofficial SDK already built by Codex at `/Users/joe/Documents/Playground/packages/poshmark-seller-sdk`, which reverse-engineers Poshmark's internal web API using session cookies.

---

## Existing SDK (`@local/poshmark-seller-sdk`)

**Location**: `/Users/joe/Documents/Playground/packages/poshmark-seller-sdk`
**Package name**: `@local/poshmark-seller-sdk`

### Already Implemented

| Method | Endpoint | Notes |
|--------|----------|-------|
| `getClosetListings(options)` | `/vm-rest/users/{userId}/posts` | Paginated, up to 500 items |
| `getListing(id)` | `/vm-rest/posts/{id}` | Single listing fetch |
| `updateListing(id, fields)` | `/vm-rest/posts/{id}` (POST) | Updates title, description, price, brand |
| `getSalesPage(maxId?)` | `/order/sales` | Returns HTML (needs parsing) |
| `getOrderDetailHtml(orderId)` | `/order/sales/{orderId}` | HTML page for order |

### Authentication

Cookie-based: pass the full browser cookie string from an authenticated poshmark.com session. The SDK extracts `uid` and `username` from cookies automatically.

Cookies to capture (via browser DevTools → Application → Cookies → poshmark.com):
- `_session_id2` (main session)
- `username` / `uid`
- `_uetsid` / `_uetvid` (tracking, may be required)

Store the full cookie string in `user_settings` with `type='credential'`, key `poshmark_cookies`.

---

## Extensions Needed

The missing operations should be added **directly to the poshmark-seller-sdk project** (`/Users/joe/Documents/Playground/packages/poshmark-seller-sdk/src/client.ts`), not in a separate wrapper. This keeps the SDK complete and self-contained, and the ai-listings platform adapter simply imports and calls it.

These additions require additional reverse-engineering of Poshmark's internal API.

### 1. Create Listing

**Endpoint** (to reverse-engineer from mobile app traffic):
- `POST /vm-rest/posts` — create a new listing post

**Payload structure** (intercept via Charles Proxy / mitmproxy on iOS Poshmark app):
```json
{
  "post": {
    "title": "...",
    "description": "...",
    "price": "25.00 USD",
    "category_v2": { ... },
    "brand": { "display": "Nike" },
    "size": { "display": "10" },
    "cover_shot": { "url": "..." },
    "pictures": [{ "url": "..." }],
    "condition": "gently_used"
  }
}
```

Requires CSRF token (same flow as `updateListing`).

### 2. Delete Listing

**Endpoint**: `DELETE /vm-rest/posts/{id}` or `POST /vm-rest/posts/{id}/delete`

Intercept from app or DevTools when deleting a listing.

### 3. Pricing Research (Sold Comps)

Poshmark has a "sold listings" view scrapeable without auth:
- `GET https://poshmark.com/brand/{brand}?availability=sold_out` — sold items by brand
- `GET https://poshmark.com/search?query={query}&availability=sold_out` — sold search results

**Approach**: Use the existing SerpAPI Google Shopping search that already targets `site:poshmark.com`. No new implementation needed for comps.

Alternative: `requestJson()` against Poshmark's search API with sold filter (reverse-engineer the query params).

### 4. Orders (Structured)

`getSalesPage()` returns HTML. Parse it to extract:
- Order IDs
- Buyer usernames
- Sale amounts
- Order status

Use Claude or a DOM parser (cheerio) to extract structured data from the HTML.

Alternatively, reverse-engineer the JSON endpoint — Poshmark's app likely has a structured orders API.

### 5. Notifications

Poshmark notifications are accessible at:
- `GET /api/users/userinfo` includes unread notification count
- Notification feed: reverse-engineer from app traffic (`/notifications` or similar)

Polling approach: check every 5 minutes via Inngest job.

### 6. Messaging (Offers + DMs)

Poshmark has two messaging channels:
- **Listing comments** (public) — buyers comment on listings
- **Offers** — private negotiation flow

**Offers API** (reverse-engineer):
- `GET /vm-rest/offers` — active offers
- `POST /vm-rest/offers/{id}/accept` — accept offer
- `POST /vm-rest/offers/{id}/decline` — decline offer
- `POST /vm-rest/offers/{id}/counter` — send counter offer

**Comments**: `GET /vm-rest/posts/{id}/comments`

---

## Reverse-Engineering Instructions

To discover missing endpoints:

1. Install **Charles Proxy** on Mac, configure as system proxy
2. Install **Charles Root Certificate** on iPhone (Settings → General → VPN & Device Management)
3. Open Poshmark iOS app, perform the action (create listing, check offers, etc.)
4. Filter Charles session for `poshmark.com` requests
5. Note: endpoint path, method, headers, request body, response format
6. Add to SDK

---

## Anti-Bot Mitigations

The SDK already handles:
- **Request throttling**: configurable `requestDelayMs` (default 250ms)
- **User-agent spoofing**: mimics Chrome browser

Additional precautions:
- Set `requestDelayMs: 500` or higher for production
- Avoid running multiple concurrent requests
- Use actual user session cookies (not programmatically generated)
- Rate limit the Inngest polling jobs (max 1 req/min for notification checks)

---

## Credential Management

```typescript
// user_settings entries:
// { key: 'poshmark_cookies', value: '_session_id2=xxx; uid=xxx; ...', type: 'credential' }

// Instantiate client:
const client = new PoshmarkClient({
  cookie: cookieString,
  requestDelayMs: 500,
});
```

Cookies expire after some period (typically weeks). Surface a "Poshmark session expired" notification when `PoshmarkHttpError` with status 401/403 is thrown, prompting re-authentication.

---

## Publishing v2 Flow

```
1. User clicks "Publish to Poshmark"
2. App calls poshmarkAdapter.createListing(unifiedListing)
3. SDK: POST /vm-rest/posts with listing data + images
4. Store returned post ID + URL in listing_platforms table
5. Show success toast: "Listed on Poshmark → [link]"
```

Images: upload listing photos to Poshmark's CDN first (reverse-engineer the photo upload endpoint), then reference the returned CDN URLs in the listing payload.

---

## Adapter File

`src/lib/platforms/adapters/poshmark.ts` wraps `@local/poshmark-seller-sdk`.

What to move poshmark-seller-sdk into the project:
- Copy `src/` files into `src/lib/platforms/poshmark-sdk/`
- Or publish as a local workspace package (add to `package.json` workspaces)
- Recommended: workspace package approach so it can be updated independently

Missing SDK methods that the adapter must implement directly (until added to the SDK):
- `createListing` — via reverse-engineered endpoint
- `deleteListing` — via reverse-engineered endpoint
- `getOrders` — parse `getSalesPage()` HTML with cheerio
- `getThreads` / `sendMessage` — reverse-engineered offers API
- `getNotifications` — polling reverse-engineered notifications endpoint
