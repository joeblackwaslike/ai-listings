# eBay Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

eBay has the most comprehensive official REST API of all platforms. The current app already uses eBay for pricing research (SerpAPI Finding API) and generates eBay listing fields via Claude. This spec upgrades the integration to direct API calls.

---

## SDK

**Library**: `@hendt/ebay-api` (npm)
- TypeScript-first, covers all REST + legacy XML APIs
- Auto-refreshing OAuth2 tokens
- Sandbox support

**Credentials** (stored in `user_api_keys`):

| Key | Type |
|-----|------|
| `ebay_client_id` | credential |
| `ebay_client_secret` | credential |
| `ebay_refresh_token` | credential (OAuth Authorization Code flow) |

OAuth scopes needed:
- `https://api.ebay.com/oauth/api_scope/sell.inventory`
- `https://api.ebay.com/oauth/api_scope/sell.fulfillment`
- `https://api.ebay.com/oauth/api_scope/commerce.notification.subscription`
- `https://api.ebay.com/oauth/api_scope/buy.browse` (for comps)

---

## API Capabilities

### Pricing Research

**Current**: SerpAPI `ebay` engine querying sold items (continue using for now).

**Upgrade path**: eBay Browse API `search` with `filter=buyingOptions:{FIXED_PRICE},conditionIds:{...}` for live comps. For sold/completed, the Finding API `findCompletedItems` gives the cleanest data — keep using SerpAPI as the wrapper since it handles auth.

No changes needed to step3 for eBay comps — SerpAPI already works well.

### Listing Creation (v2 publishing)

**API**: Sell Inventory API

Flow:
1. `PUT /sell/inventory/v1/inventory_item/{sku}` — create/update inventory item
2. `POST /sell/inventory/v1/offer` — create offer (price, marketplace, listing format)
3. `POST /sell/inventory/v1/offer/{offerId}/publish` — publish listing

```typescript
// src/lib/platforms/adapters/ebay.ts

// createListing(listing: UnifiedListing) → Promise<{ platformId, url }>
//   1. Build inventory item from listing.platformFields.ebay
//   2. PUT /sell/inventory/v1/inventory_item/{listing.internalId}
//   3. POST /sell/inventory/v1/offer → get offerId
//   4. POST offer/{offerId}/publish → get listingId
//   5. Return { platformId: listingId, url: `https://www.ebay.com/itm/${listingId}` }

// updateListing(platformId, updates)
//   - Update inventory item SKU fields + reprice offer

// deleteListing(platformId)
//   - End listing: PUT /sell/inventory/v1/offer/{offerId} with status=ENDED
//   - Or withdraw offer

// getListing(platformId)
//   - GET /sell/inventory/v1/offer/{offerId}

// getMyListings()
//   - GET /sell/inventory/v1/offer?marketplace_id=EBAY_US
```

### Orders

**API**: Sell Fulfillment API

```typescript
// getOrders(since?) → GET /sell/fulfillment/v1/order?filter=creationdate:[{since}...]
// getOrder(orderId) → GET /sell/fulfillment/v1/order/{orderId}
// markShipped(orderId, tracking)
//   → POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
//      { lineItems, shippedDate, shippingCarrierCode, trackingNumber }
```

### Notifications

**API**: Commerce Notification API (webhook subscriptions)

eBay pushes events to a registered endpoint. Subscribe to:
- `MARKETPLACE_ACCOUNT_DELETION` (required for all apps)
- `ITEM_SOLD` — when an order is placed
- `OFFER_ACCEPTED` — Best Offer accepted
- `BUYER_INQUIRY` — new message/question from buyer

Register webhook endpoint: `POST /api.ebay.com/commerce/notification/v1/subscription`

**Webhook handler**: `src/app/api/webhooks/ebay/route.ts`
- Verify eBay signature
- Map event type → insert into `notifications` table
- Emit Inngest event if needed

### Messaging

**API**: Trading API (legacy, still supported)

```typescript
// getThreads() → GetMyMessages (Trading API SOAP/XML via @hendt/ebay-api)
// getThread(threadId) → GetMyMessages with MessageIDs
// sendMessage(threadId, body)
//   → AddMemberMessageRTQ (reply to question)
//   or AddMemberMessageAAQToPartner (respond to buyer)
```

Note: eBay messaging via API is limited to responding to existing threads (buyer inquiries). Proactive messaging to buyers is not supported.

---

## Image Handling

eBay listing images must be hosted at a public URL. Our app's Supabase storage URLs work if public. Include up to 12 images (eBay limit).

For the `inventory_item` payload:
```json
{
  "product": {
    "imageUrls": ["https://your-supabase-url/storage/v1/..."]
  }
}
```

---

## Category Mapping

eBay categories vary by item type. The step4a prompt already generates `ebay.category_id`. Key IDs:

| Category | eBay Category ID |
|----------|-----------------|
| Handbags | 169291 |
| Sneakers | 155202 |
| Electronics | 9355 |
| Clothing | 53159 |
| Watches | 31387 |
| Keyboards/Computer | 3676 (Keyboards & Keypads) |
| Jewelry | 281 |

For watches specifically: use "Wristwatches" (31387) for Movado.

---

## Condition ID Mapping

| Canonical Condition | eBay Condition ID |
|--------------------|------------------|
| New with tags | 1000 |
| Like new | 1500 |
| Excellent | 2000 |
| Good | 2500 |
| Fair | 3000 |
| Poor | 7000 |

---

## Rate Limits

- Authorization Code tokens: higher limits (per-endpoint, ~5,000+ calls/day)
- Response headers: `X-eBay-C-RateLimit-Remaining` — log and alert if < 100

---

## Error Handling

eBay API errors return structured JSON with `errors[]` array. Map common codes:
- `25001` — Item not found → `NotFoundError`
- `25002` — Item ended → `ListingEndedError`
- `32100` — Auth token expired → trigger token refresh

---

## Adapter File

`src/lib/platforms/adapters/ebay.ts` implements `PlatformSDK`.

Unsupported methods:
- `replyToOffer` → partial support (can accept/decline Best Offers via Trading API)
- `searchSoldComps` → delegated to existing SerpAPI step3 logic (no change needed)
