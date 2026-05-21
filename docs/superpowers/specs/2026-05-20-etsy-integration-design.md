# Etsy Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

Etsy has a well-documented public REST API (v3) with OAuth 2.0 + PKCE. It's the best-documented platform in our stack. Ideal for vintage watches, collectibles (Tokidoki and similar), and handmade/unique items.

**Best categories for our inventory:**
- Vintage watches (20+ years old Movado, Seiko, etc.)
- Collectibles: Tokidoki, limited edition toys, art figures
- Vintage clothing and accessories

---

## SDK

**Library**: `@profplum700/etsy-v3-api-client` (npm) or generated from official OpenAPI spec.

Official OpenAPI spec: `https://www.etsy.com/openapi/generated/oas/3.0.0.json`

**Credentials** (stored in `user_api_keys` + `user_settings`):

| Key | Store | Type |
|-----|-------|------|
| `etsy_client_id` (Keystring) | `user_api_keys` | credential |
| `etsy_access_token` | `user_settings` | credential |
| `etsy_refresh_token` | `user_settings` | credential |
| `etsy_shop_id` | `user_settings` | string |

OAuth flow: Authorization Code + PKCE required. Register redirect URI in Etsy developer portal.

---

## API Capabilities

### Listing Management

**Base URL**: `https://openapi.etsy.com/v3/application`

```typescript
// createListing(listing: UnifiedListing) → { platformId, url }
// POST /shops/{shop_id}/listings
{
  "quantity": 1,
  "title": "...",          // ≤140 chars
  "description": "...",
  "price": 45.00,          // float, USD
  "who_made": "someone_else",  // "i_did" | "someone_else" | "collective"
  "when_made": "2000_2009",    // or "before_1990" for vintage
  "taxonomy_id": 1234,         // Etsy taxonomy node
  "type": "physical",
  "shipping_profile_id": 0,    // user must set this up in Etsy
  "shop_section_id": null,
  "tags": ["tag1", "tag2"],    // ≤13 tags, each ≤20 chars
  "materials": ["leather"],
  "is_customizable": false,
  "is_personalizable": false,
  "should_auto_renew": true,
  "state": "draft"             // create as draft, then PATCH to "active"
}

// Activate listing (make it live):
// PATCH /shops/{shop_id}/listings/{listing_id}
{ "state": "active" }

// updateListing(platformId, updates)
// PATCH /shops/{shop_id}/listings/{listing_id}

// deleteListing(platformId)
// DELETE /shops/{shop_id}/listings/{listing_id}

// getListing(platformId)
// GET /listings/{listing_id}

// getMyListings(filters?)
// GET /shops/{shop_id}/listings?state=active
```

### Listing Images

Images must be uploaded separately after listing creation:

```typescript
// POST /shops/{shop_id}/listings/{listing_id}/images
// multipart/form-data with `image` field
// Returns: listing_image_id, url_fullxfull
```

### Pricing Research

Etsy does NOT expose sold/completed listing data via API. Options:
1. **SerpAPI Google Shopping** (already implemented for luxury items) — targets `site:etsy.com` search results
2. **Etsy search** (active listings only, not sold) — less useful for comps
3. **Web scraping** — Etsy sold listings are not publicly visible without a workaround

**Decision**: Extend the step3 SerpAPI Google Shopping search to include `site:etsy.com` for collectibles and watches. No Etsy-native comps API.

### Orders

```typescript
// getOrders(since?)
// GET /shops/{shop_id}/receipts?was_paid=true&was_shipped=false
// Each receipt = one order; contains buyer info, items, totals

// getOrder(orderId)
// GET /shops/{shop_id}/receipts/{receipt_id}

// markShipped(orderId, tracking)
// POST /shops/{shop_id}/receipts/{receipt_id}/tracking
{ "tracking_code": "...", "carrier_name": "usps" | "ups" | "fedex" }
```

### Notifications

Etsy Webhooks API (v3):
- Register: `POST /application/webhooks`
- Events: `RECEIPT_CREATED` (new order), `LISTING_INVENTORY_UPDATED`
- Webhook handler: `src/app/api/webhooks/etsy/route.ts`

Verify webhook signature using `X-Etsy-Signature` header.

### Messaging

**Not available in Etsy API v3.** Etsy conversations (buyer-seller DMs) are explicitly NOT exposed via API (confirmed by developer forum posts). No workaround via official API.

Options:
- Notify user to check Etsy Messages manually
- Future: reverse-engineer Etsy's web messaging endpoints (low priority)

---

## Taxonomy IDs (Relevant Categories)

| Our Category | Etsy Taxonomy | ID |
|-------------|---------------|----|
| watches (vintage) | Jewelry > Watches | 1 (check actual ID via GET /taxonomy/seller) |
| collectibles (Tokidoki) | Collectibles & Memorabilia | ~2078 |
| handbag | Bags & Purses > Handbags | ~1731 |
| jewelry | Jewelry | ~200 |
| clothing | Clothing > Women's | varies |

Fetch full taxonomy: `GET /seller-taxonomy/nodes` (public, no auth needed).

### Vintage Flag

Etsy defines "vintage" as **20+ years old** (made before 2006 as of 2026). The app should:
1. During step4a: set `etsy.when_made` based on item age
2. For items clearly vintage (pre-2006): `when_made = "before_2006"` or appropriate decade
3. For Tokidoki: mostly modern → `when_made = "2010_2019"` or `"made_to_order"` (not vintage)

Tokidoki and similar collectibles fall under `who_made = "someone_else"` (mass-produced).

---

## Tag Generation Rules

Etsy tags are critical for SEO. Claude generates them in step4a with rules:
- Max 13 tags
- Each tag ≤20 chars
- Multi-word tags count as one (e.g., "vintage movado watch" = 20 chars exactly)
- Use buyer search terms: brand, style, color, material, occasion

---

## Condition Mapping

Etsy has no structured condition field — condition is expressed in the description. Claude should front-load the description with condition:

```
"Excellent condition — light wear on bracelet clasp, crystal scratch-free. Fully functional."
```

---

## Rate Limits

- 10,000 requests/day (sliding 24h window)
- 10 requests/second
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`

---

## Adapter File

`src/lib/platforms/adapters/etsy.ts` implements `PlatformSDK`.

Unsupported methods:
- `searchSoldComps` → falls back to SerpAPI Google Shopping with `site:etsy.com`
- `getThreads` / `sendMessage` → not available; throw `UnsupportedOperationError`
- `replyToOffer` → Etsy doesn't have an offer system like Poshmark
