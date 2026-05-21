# Mercari Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

Mercari has a partial official API (Mercari Shops, GraphQL-based) plus a reverse-engineerable consumer API. The current app has Mercari URL fields but no platform_fields or publishing UI.

---

## API Access Tiers

| API | Coverage | Auth | Notes |
|-----|----------|------|-------|
| Mercari Shops API | GraphQL, full CRUD | Bearer token | For merchant/shop accounts; 10k pts/hr rate limit |
| Consumer API (reverse-eng) | All consumer features | OAuth 2.0 OIDC | Powers the mercari.com web/app |

**Strategy**: Use Mercari Shops API where available (listings, orders); reverse-engineer the consumer API for pricing comps (sold items search) and messaging.

---

## Credentials

**Mercari Shops API** (stored in `user_api_keys`):

| Key | Type |
|-----|------|
| `mercari_api_token` | credential |

Note: Mercari Shops API requires **static IP registration** (being deprecated Aug 2025 — new registration process via account settings). Register your k8s cluster's egress IP.

**Consumer API** (if needed for comps/messaging):
| Key | Type |
|-----|------|
| `mercari_access_token` | credential |
| `mercari_refresh_token` | credential |

---

## API Capabilities

### Pricing Research (Sold Comps)

Mercari doesn't expose sold listings via the Shops API. Use the consumer API search with status filter:

**Endpoint** (reverse-engineered from mercari.com web app):
```
POST https://api.mercari.jp/v2/entities:search
Content-Type: application/json

{
  "pageToken": "",
  "searchSessionId": "...",
  "indexRouting": "INDEX_ROUTING_UNSPECIFIED",
  "searchCondition": {
    "keyword": "{keyboard name}",
    "status": ["STATUS_SOLD_OUT"],
    "categoryId": [],
    "brandId": []
  },
  "defaultDatasets": ["DATASET_TYPE_MERCARI"],
  "serviceFrom": "suruga"
}
```

Response: array of sold items with `price`, `name`, `status`, `created`, `thumbnails`.

Map each result to `PlatformComp`.

**Alternative**: Use existing SerpAPI Google Shopping search targeting `site:mercari.com` (already works for some categories).

### Listing Management

**Mercari Shops GraphQL API** (`https://api.mercari-shops.com/v1/graphql`):

```graphql
# Create item
mutation CreateItem($input: CreateItemInput!) {
  createItem(input: $input) {
    item { id name price status }
  }
}

# Update item (price, status)
mutation UpdateItem($input: UpdateItemInput!) {
  updateItem(input: $input) {
    item { id name price status }
  }
}

# Delete/delist item
mutation DeleteItem($id: ID!) {
  deleteItem(id: $id) { success }
}

# List seller's items
query ListItems($status: ItemStatus) {
  items(status: $status) {
    nodes { id name price status createdAt }
  }
}
```

**Input fields for CreateItem**:
- `name` (≤40 chars for title)
- `description`
- `price` (integer, yen — USD if US marketplace)
- `condition` (LIKE_NEW / GOOD / FAIR / POOR)
- `categoryId` (Mercari taxonomy)
- `imageUrls` (hosted URLs)

**Sandbox**: `https://api.mercari-shops-sandbox.com/v1/graphql` for testing.

### Orders

Mercari Shops GraphQL:
```graphql
query ListOrders($status: OrderStatus) {
  orders(status: $status) {
    nodes {
      id status createdAt
      item { id name price }
      buyer { id name }
      shippingInfo { trackingNumber carrier }
    }
  }
}

mutation ShipOrder($orderId: ID!, $trackingNumber: String!, $carrier: String!) {
  shipOrder(orderId: $orderId, trackingNumber: $trackingNumber, carrier: $carrier) {
    order { id status }
  }
}
```

### Notifications

Mercari Shops webhooks (if available) or polling:
- Events: `item.sold`, `order.created`, `review.received`
- Webhook endpoint: `src/app/api/webhooks/mercari/route.ts`

If webhooks not available: poll via Inngest every 15 minutes.

### Messaging

Mercari has a buyer-seller messaging system. Consumer API (reverse-engineer):
- `GET /v1/messages/{transactionId}` — message thread for an order
- `POST /v1/messages/{transactionId}` — send a message

Map to `PlatformThread` / `PlatformMessage` types.

---

## Category Mapping

Mercari US categories (relevant ones):

| Our Category | Mercari Category | ID |
|-------------|------------------|----|
| watches | Accessories > Watches | ~2012 |
| keyboards | Electronics > Computers & Tablets > Keyboards & Mice | ~7027 |
| sneakers | Shoes > Sneakers & Athletic | ~1015 |
| handbag | Bags & Purses > Handbags | ~1114 |
| jewelry | Jewelry & Accessories > Jewelry | ~2001 |
| collectibles | Collectibles | ~2075 |

Fetch full taxonomy: `GET https://api.mercari.com/master/v1/master_data` (or equivalent Shops API endpoint).

---

## Condition Mapping

| Canonical | Mercari |
|-----------|---------|
| New with tags | LIKE_NEW |
| Like new | LIKE_NEW |
| Excellent | GOOD |
| Good | GOOD |
| Fair | FAIR |
| Poor | POOR |

---

## Rate Limits

Mercari Shops API: 10,000 points/hour. Query costs vary (simple queries ~1pt, mutations ~10pts). At polling cadence this is generous.

---

## Anti-Bot (Consumer API)

The consumer API uses Cloudflare + TLS fingerprinting. Approaches:
- Use `node-fetch` with realistic TLS settings (or undici with TLS config)
- Set `User-Agent` to match Chrome browser
- Include `dpop` token if required (Mercari uses DPoP for OAuth per their engineering blog)
- Rotate access tokens with refresh tokens

---

## Adapter File

`src/lib/platforms/adapters/mercari.ts` implements `PlatformSDK`.

Dependency:
- Mercari Shops API: direct GraphQL requests (no npm SDK needed — just `graphql-request`)
- Consumer API: raw `fetch` calls with OAuth headers
