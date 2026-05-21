# TheRealReal Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

TheRealReal (TRR) is a luxury consignment marketplace. Unlike the other platforms, TRR is **read-only** for our integration — we use it exclusively for **pricing research** on luxury watches, handbags, and jewelry.

TheRealReal does NOT expose a public seller API. Consigning items requires contacting a Consignment Concierge or submitting via their website manually. We don't automate consignment at this time.

---

## Role in the System

| Operation | Supported | Method |
|-----------|-----------|--------|
| Pricing research (sold comps) | ✓ | Apify scraper API |
| Listing creation | ✗ | Manual consignment flow |
| Order management | ✗ | N/A (TRR handles fulfillment) |
| Notifications | ✗ | N/A |
| Messaging | ✗ | N/A |

---

## Current Integration

The app already queries TheRealReal indirectly via SerpAPI's Google Shopping engine:

```typescript
// src/lib/pipeline/step3-pricing-research.ts
query: `${brand} ${model} resale sold price site:poshmark.com OR site:therealreal.com`
```

This runs automatically for all `isLuxury === true` items. Movado will trigger it once added to LUXURY_BRANDS.

**This works for most use cases** and requires no additional API keys.

---

## Enhanced Pricing Research (Optional)

For higher-quality TRR data — especially for watches where TRR is the primary luxury resale venue — use the **Apify TRR scraper** directly.

**Apify actor**: `lexis-solutions/therealreal-com-scraper`
**API endpoint**: `https://api.apify.com/v2/acts/lexis-solutions~therealreal-com-scraper/runs`

### How It Works

1. POST to Apify to start a scraper run with search query
2. Poll or use webhook for completion
3. Retrieve results: brand, title, price, condition, URL, sold status

### Credentials

| Key | Store | Type |
|-----|-------|------|
| `apify_api_token` | `user_api_keys` | credential |

### Implementation

```typescript
// src/lib/platforms/adapters/therealreal.ts

async searchSoldComps(query: string): Promise<PlatformComp[]> {
  // Start Apify run
  const run = await fetch('https://api.apify.com/v2/acts/lexis-solutions~therealreal-com-scraper/runs', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apifyToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startUrls: [{ url: `https://www.therealreal.com/collections/women/jewelry-watches?keywords=${encodeURIComponent(query)}&sort=sold` }],
      maxItems: 20,
    }),
  });

  // Poll for completion (or use Apify webhook)
  const results = await pollApifyRun(run.id);

  return results
    .filter(item => item.status === 'Sold')
    .map(item => ({
      platform: 'therealreal',
      title: item.title,
      soldPrice: Math.round(parseFloat(item.price.replace(/[^0-9.]/g, '')) * 100),
      condition: item.condition,
      url: item.url,
      soldAt: item.soldAt ? new Date(item.soldAt) : null,
    }));
}
```

### When to Use Apify vs. SerpAPI

| Scenario | Use |
|----------|-----|
| Standard luxury item (handbag, jewelry) | SerpAPI Google Shopping (already works) |
| Luxury watch (Movado, Rolex, Omega) | Apify TRR scraper (more complete watch data) |
| Quick pricing pass | SerpAPI (faster) |
| High-confidence watch pricing | Apify (more results, TRR-specific) |

Switch based on category: use Apify for `watches`, SerpAPI for other luxury categories.

---

## Direct Scraping (Fallback)

If Apify is not configured, fall back to scraping TRR's search results directly using the SerpAPI Google Shopping approach. This is already implemented and works.

No raw HTML scraping needed — Apify handles the complexity of TRR's Cloudflare protection and JS rendering.

---

## TRR Listing Comps Data Fields

From Apify scraper results:
- `title` — item name (e.g., "Movado Museum Watch, Gold Tone")
- `price` — current or sold price as string ("$285")
- `condition` — "Excellent", "Good", "Fair", etc. (maps to our condition scale)
- `url` — TRR listing URL
- `brand` — extracted brand
- `status` — "Available" or "Sold"

Filter for `status === 'Sold'` to get reliable comp data.

---

## No PlatformSDK Implementation

TheRealReal does not need to implement the full `PlatformSDK` interface since it's read-only. It only needs:

```typescript
// src/lib/platforms/adapters/therealreal.ts
export class TheRealRealAdapter {
  async searchSoldComps(query: string): Promise<PlatformComp[]>
  // All other PlatformSDK methods throw UnsupportedOperationError
}
```

This is intentional. TheRealReal is a data source, not a publishing destination.
