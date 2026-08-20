# Comps Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed bugs behind "weird 20%-confidence pricing" on live listings — step4a silently overwriting step3's real price, active comps never reaching confidence/pricing, a dead Mercari host, an unused TheRealReal fetcher — add two new working comp sources (eBay-sold via SerpAPI, TheRealReal), and add report-first regeneration tooling with replace-on-regen semantics.

**Architecture:** Hardening pass on the existing `step3-pricing-research.ts` fetcher-pattern file plus a precedence fix in `step4a-draft-listing.ts`. No schema changes. Every new/modified fetcher follows the file's existing try/catch-return-empty resilience convention.

**Tech Stack:** Next.js App Router, Supabase (self-hosted), SerpAPI, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-14-comps-pipeline-hardening-design.md`

---

### Task 1: Fix the headline bug — step4a overwriting step3's real price

**Files:**
- Modify: `src/lib/pipeline/step4a-draft-listing.ts:192-213`

- [ ] **Step 1: Change the `pushPipelineStep` call to only fill the gap step3 left**

In `src/lib/pipeline/step4a-draft-listing.ts`, change:

```ts
  await pushPipelineStep(listingId, {
    pipeline_step: 4,
    title: draft.canonical_title,
    description: draft.canonical_description,
    suggested_price_cents: draft.suggested_price_cents,
    platform_fields: {
```

to:

```ts
  await pushPipelineStep(listingId, {
    pipeline_step: 4,
    title: draft.canonical_title,
    description: draft.canonical_description,
    // step3's comps-derived price is authoritative whenever it exists (including a
    // real low-confidence estimate) — Claude's own guess here only fills the gap
    // when step3 genuinely found nothing to work with.
    suggested_price_cents: suggestedPriceCents ?? draft.suggested_price_cents,
    platform_fields: {
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (the `suggestedPriceCents` parameter already exists on `runStep4aDraftListing`, line 28 — this just uses it where it wasn't being used before)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/step4a-draft-listing.ts
git commit -m "fix(pricing): stop step4a from overwriting step3's comps-derived price

runStep4aDraftListing always wrote its own Claude-generated
suggested_price_cents, discarding step3's real (or honestly-null)
comps-based price every time. step3's number now wins whenever it
exists; step4a's guess only fills a genuine gap."
```

## Context

This is Task 1 of a 14-task plan (`docs/superpowers/plans/2026-08-14-comps-pipeline-hardening.md`, spec: `docs/superpowers/specs/2026-08-14-comps-pipeline-hardening-design.md`). This is the single highest-value fix in the whole plan — confirmed via direct production DB inspection that every one of the 4 currently-live listings has a `suggested_price_cents` that traces to this overwrite, not to comps. `runStep4aDraftListing` already receives `suggestedPriceCents: number | null` as its 3rd parameter (from `intake-pipeline.ts:147-148`, which re-fetches the listing row after step3 runs) — this task just makes it actually get used at the write site instead of being discarded. No other file needs to change for this task; `agent/tools.ts`'s `buildDescription` was checked and confirmed to only *read* `suggested_price_cents`, never write it — it has no equivalent bug.

**Do NOT touch anything else in this file** — this is a single-line-semantics change, not a refactor.

---

### Task 2: Remove the dead Mercari comp fetchers

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Delete the dead fetchers and the dead host constant**

In `src/lib/pipeline/step3-pricing-research.ts`, delete these three blocks entirely (lines 224, 302-334, 336-369 in the current file):

```ts
const MERCARI_CONSUMER_API = 'https://api.mercari.com/v2/entities:search'
```

```ts
async function fetchMercariSoldComps(
  query: string,
  accessToken: string
): Promise<Array<{ title: string; priceCents: number; soldAt: string | null; listingUrl: string }>> {
  if (!accessToken) return []
  try {
    const body = {
      pageToken: '',
      searchSessionId: crypto.randomUUID(),
      indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
      searchCondition: { keyword: query, status: ['STATUS_SOLD_OUT'], categoryId: [], brandId: [] },
      defaultDatasets: ['DATASET_TYPE_MERCARI'],
      serviceFrom: 'suruga',
    }
    const res = await fetch(MERCARI_CONSUMER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: Array<{ id: string; name: string; price: number; updated: number }> }
    return (data.items ?? [])
      .filter((item) => item.name && item.price > 0)
      .map((item) => ({
        title: item.name,
        priceCents: Math.round(item.price * 100),
        soldAt: item.updated ? new Date(item.updated * 1000).toISOString() : null,
        listingUrl: `https://www.mercari.com/us/item/${item.id}`,
      }))
  } catch {
    return []
  }
}

async function fetchMercariActiveFloor(
  query: string,
  accessToken: string
): Promise<Array<{ title: string; priceCents: number; listingUrl: string }>> {
  if (!accessToken) return []
  try {
    const body = {
      pageToken: '',
      searchSessionId: crypto.randomUUID(),
      indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
      searchCondition: { keyword: query, status: ['STATUS_ON_SALE'], categoryId: [], brandId: [] },
      defaultDatasets: ['DATASET_TYPE_MERCARI'],
      serviceFrom: 'suruga',
      sort: { by: 'SORT_PRICE', order: 'ORDER_ASC' },
      paging: { limit: 10, offset: 0 },
    }
    const res = await fetch(MERCARI_CONSUMER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: Array<{ id: string; name: string; price: number }> }
    return (data.items ?? [])
      .filter((item) => item.name && item.price > 0)
      .map((item) => ({
        title: item.name,
        priceCents: Math.round(item.price * 100),
        listingUrl: `https://www.mercari.com/us/item/${item.id}`,
      }))
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Remove the calls from the parallel fetch and the loops that consume their output**

Change:

```ts
  const [ebayActive, serpResults, redditComps, retailResult, poshmarkSold, poshmarkActive, mercariSold, mercariActive] = await Promise.all([
    searchEbayActive(searchQuery),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailPrice(step2.brand, model, apiKeys.serpapi),
    fetchPoshmarkSoldComps(searchQuery, apiKeys.poshmarkCookies),
    fetchPoshmarkActiveFloor(searchQuery, apiKeys.poshmarkCookies),
    fetchMercariSoldComps(searchQuery, apiKeys.mercariToken),
    fetchMercariActiveFloor(searchQuery, apiKeys.mercariToken),
  ])
```

to:

```ts
  const [ebayActive, serpResults, redditComps, retailResult, poshmarkSold, poshmarkActive] = await Promise.all([
    searchEbayActive(searchQuery),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailPrice(step2.brand, model, apiKeys.serpapi),
    fetchPoshmarkSoldComps(searchQuery, apiKeys.poshmarkCookies),
    fetchPoshmarkActiveFloor(searchQuery, apiKeys.poshmarkCookies),
  ])
```

Delete this loop entirely (the one consuming `mercariSold`):

```ts
  for (const item of mercariSold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'mercari', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
    })
  }
```

Delete this loop entirely (the one consuming `mercariActive`):

```ts
  for (const item of mercariActive) {
    activeRows.push({
      listing_id: listingId, source: 'mercari_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
    })
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — `apiKeys.mercariToken` is still a valid field on `ApiKeys` (used elsewhere, e.g. the Mercari platform adapter for selling), just no longer referenced in this file

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): remove dead Mercari comp fetchers

api.mercari.com does not resolve (confirmed via public DNS and
in-cluster DNS lookup) -- every call has always silently returned
empty. Every open-source Mercari-US project hits the same Cloudflare
wall; no real API exists. Dropping as a source rather than chasing a
scraping investment (ai-listings-b26 decision)."
```

## Context

This is Task 2. `MERCARI_CONSUMER_API`/`fetchMercariSoldComps`/`fetchMercariActiveFloor` reference `api.mercari.com`, confirmed via `dns.google/resolve` (Google's public DoH resolver) to be `NXDOMAIN` — it has never existed in public DNS. Confirmed again directly inside the running production pod (`getent hosts api.mercari.com` fails; `poshmark.com` resolves fine from the same pod). `src/lib/platforms/adapters/mercari.ts`'s `CONSUMER_API` constant (used by `MercariAdapter.searchSoldComps()`, a *different* code path for the platform-adapter/selling flow, not touched by this task) has the identical dead host — out of scope for this task, note it in the final task's summary but don't fix it here (it's not on step3's critical path).

**Before you begin:** if the current line numbers in the file don't match what's quoted above exactly (e.g. because Task 1 shifted something — it shouldn't have, different function), read the file fresh and locate the blocks by content, not by line number.

---

### Task 3: Add the SerpAPI eBay sold-comp fetcher

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Add the fetcher function**

Add this new function to `src/lib/pipeline/step3-pricing-research.ts`, placed after `fetchRetailPrice` (i.e. right before the `generatePricingMethodology` function):

```ts
interface SerpApiEbayResult {
  title?: string
  price?: { extracted_value?: number }
  sold_date?: string
  link?: string
  condition?: string
}

interface SerpApiEbayResponse {
  organic_results?: SerpApiEbayResult[]
  error?: string
}

// SerpAPI's dedicated eBay engine scrapes eBay's own public "Sold Items" search page
// (show_only=Sold) -- no OAuth scope needed, unlike Marketplace Insights. Observed
// flaky in practice (503s, multi-minute timeouts on some queries) -- always resolve
// to an empty array rather than let a slow/failed scrape block the pipeline.
async function fetchEbaySoldComps(
  query: string,
  apiKey: string
): Promise<Array<{ title: string; priceCents: number; soldAt: string | null; listingUrl: string }>> {
  if (!apiKey) return []
  try {
    const url = new URL('https://serpapi.com/search')
    url.searchParams.set('engine', 'ebay')
    url.searchParams.set('_nkw', query)
    url.searchParams.set('show_only', 'Sold')
    url.searchParams.set('api_key', apiKey)

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return []

    const data = (await res.json()) as SerpApiEbayResponse
    if (data.error) return []

    return (data.organic_results ?? [])
      .filter((r) => r.title && r.price?.extracted_value && r.sold_date)
      .map((r) => ({
        title: r.title ?? '',
        priceCents: Math.round((r.price?.extracted_value ?? 0) * 100),
        soldAt: r.sold_date ? new Date(r.sold_date).toISOString() : null,
        listingUrl: r.link ?? '',
      }))
      .filter((c) => c.priceCents > 0)
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (new unused function is fine at this stage — Task 5 wires it in)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "feat(pricing): add SerpAPI eBay sold-listings fetcher

Real eBay sold-comp data (sold_date + price) via SerpAPI's engine=ebay
show_only=Sold, without the blocked Marketplace Insights OAuth scope.
Live-tested during planning: real but flaky (503/timeout observed) --
built with a timeout and graceful-empty-return, matching every other
fetcher in this file. Not wired in yet -- Task 5."
```

## Context

This is Task 3. `SerpApiEbayResponse.organic_results[].sold_date` is the field SerpAPI's own docs (`serpapi.com/ebay-organic-results`) describe as "Date when the item was sold," present only when `show_only=Sold` actually finds a sold result. `price.extracted_value` is a decimal dollar amount (matches the shape `fetchSerpComps`/`SerpShoppingResult` already use elsewhere in this file for Google Shopping). `apiKeys.serpapi` (the same key used by `fetchSerpComps`/`fetchRetailPrice`) is what you'll pass in when this gets wired in — this task only adds the function, it doesn't call it yet.

---

### Task 4: Add the TheRealReal sold-comp fetcher

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Add the fetcher function**

Add this new function to `src/lib/pipeline/step3-pricing-research.ts`, placed immediately after the `fetchEbaySoldComps` function added in Task 3:

```ts
interface SerpApiOrganicResult {
  title?: string
  snippet?: string
  link?: string
}

interface SerpApiGoogleResponse {
  organic_results?: SerpApiOrganicResult[]
}

function extractPriceFromSnippet(snippet: string): number | null {
  const match = snippet.match(/\$([\d,]+(?:\.\d{2})?)/)
  if (!match) return null
  const dollars = parseFloat(match[1].replace(/,/g, ''))
  return isNaN(dollars) ? null : Math.round(dollars * 100)
}

// site:therealreal.com search via SerpAPI's generic Google engine. TheRealReal has
// no public API; TheRealRealAdapter.searchSoldComps() (src/lib/platforms/adapters/
// therealreal.ts) already implements this exact approach but takes a userId the
// pricing pipeline doesn't have and never actually uses it (only reads
// process.env.SERPAPI_API_KEY) -- reimplemented standalone here to match this
// file's existing fetcher(query, apiKey) shape instead of instantiating that class.
// Search-result snippets can't distinguish "for sale" from "sold" -- every result
// here is classified therealreal_active by default; URL-verification (Task 12)
// reclassifies confirmed sold items.
async function fetchTheRealRealComps(
  query: string,
  apiKey: string
): Promise<Array<{ title: string; priceCents: number; listingUrl: string }>> {
  if (!apiKey) return []
  try {
    const url = new URL('https://serpapi.com/search')
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', `site:therealreal.com ${query}`)
    url.searchParams.set('num', '10')
    url.searchParams.set('api_key', apiKey)

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []

    const data = (await res.json()) as SerpApiGoogleResponse
    return (data.organic_results ?? [])
      .map((r) => {
        const priceCents = r.snippet ? extractPriceFromSnippet(r.snippet) : null
        if (!priceCents) return null
        return { title: r.title ?? '', priceCents, listingUrl: r.link ?? '' }
      })
      .filter((c): c is { title: string; priceCents: number; listingUrl: string } => c !== null)
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "feat(pricing): add TheRealReal comp fetcher

Live-verified during planning: site:therealreal.com search via
SerpAPI returns genuinely relevant, price-bearing results (SerpAPI
key already configured, already used elsewhere in this file). Not
wired in yet -- Task 5."
```

## Context

This is Task 4. `TheRealRealAdapter.searchSoldComps()` (`src/lib/platforms/adapters/therealreal.ts:36-71`) already does this exact SerpAPI call but is dead code from the pricing pipeline's perspective (`step3-pricing-research.ts` never calls it) and its class constructor requires a `userId` that `runStep3PricingResearch` doesn't have on hand. Rather than thread a userId through just to instantiate an unused-field class, this reimplements the same logic as a standalone function matching this file's established `fetchX(query, apiKey)` pattern — consistent with how `fetchSerpComps`/`fetchRetailPrice`/`fetchEbaySoldComps` are already written.

---

### Task 5: Wire the two new fetchers into the parallel fetch and comp classification

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Add both fetchers to the parallel fetch**

Change (this is the `Promise.all` as it stands after Task 2's edit):

```ts
  const [ebayActive, serpResults, redditComps, retailResult, poshmarkSold, poshmarkActive] = await Promise.all([
    searchEbayActive(searchQuery),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailPrice(step2.brand, model, apiKeys.serpapi),
    fetchPoshmarkSoldComps(searchQuery, apiKeys.poshmarkCookies),
    fetchPoshmarkActiveFloor(searchQuery, apiKeys.poshmarkCookies),
  ])
```

to:

```ts
  const [ebayActive, serpResults, redditComps, retailResult, poshmarkSold, poshmarkActive, ebaySold, theRealRealComps] = await Promise.all([
    searchEbayActive(searchQuery),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailPrice(step2.brand, model, apiKeys.serpapi),
    fetchPoshmarkSoldComps(searchQuery, apiKeys.poshmarkCookies),
    fetchPoshmarkActiveFloor(searchQuery, apiKeys.poshmarkCookies),
    fetchEbaySoldComps(searchQuery, apiKeys.serpapi),
    fetchTheRealRealComps(searchQuery, apiKeys.serpapi),
  ])
```

- [ ] **Step 2: Add `ebaySold` to the sold-comp rows**

Immediately after the existing `poshmarkSold` loop (the one that pushes `source: 'poshmark'` rows), add:

```ts
  for (const item of ebaySold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'ebay', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
    })
  }
```

- [ ] **Step 3: Add `theRealRealComps` to the active rows**

Immediately after the existing `poshmarkActive` loop (the one that pushes `source: 'poshmark_active'` rows into `activeRows`), add:

```ts
  for (const item of theRealRealComps) {
    activeRows.push({
      listing_id: listingId, source: 'therealreal_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
    })
  }
```

- [ ] **Step 4: Remove the now-redundant SerpAPI-Shopping TheRealReal substring classification**

The existing `serpResults` classification loop still has an incidental `therealreal` substring check from the old Google Shopping path — leave that loop as-is (it's classifying *Google Shopping* results, a different SerpAPI call than the new dedicated TheRealReal fetcher; both are valid, complementary sources and may both surface real matches — do not remove it, just note that `therealreal_active` may now come from two different fetchers, which is fine, they'll dedupe naturally like any other overlapping source).

- [ ] **Step 5: Type-check and run the full test suite**

Run: `npx tsc --noEmit && node --import tsx --test src/**/*.test.ts`
Expected: both clean

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "feat(pricing): wire eBay-sold and TheRealReal fetchers into step3

Joins the existing parallel comp fetch. eBay-sold rows are real sold
comps (source: 'ebay', dated). TheRealReal rows default to
therealreal_active (search snippets can't confirm sold-vs-active
without loading the page -- see Task 12)."
```

## Context

This is Task 5, completing the source-wiring started in Tasks 3-4. After this task, `runStep3PricingResearch` has 8 parallel fetches instead of the original 8 (Mercari's 2 removed in Task 2, eBay-sold and TheRealReal's 2 added here — net count unchanged, composition different). No behavior change yet to confidence/pricing logic — that's Tasks 7-8.

---

### Task 6: Active-comp confidence and price fallback when there are zero sold comps

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Compute an active-comp-derived estimate when sold comps are empty**

Locate this block (unchanged by prior tasks):

```ts
  const confidenceScore = calcConfidenceScore(filteredComps.length)

  const prices = filteredComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPriceCents =
    prices.length === 0
      ? null
      : prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid]
```

Change to:

```ts
  // When there are zero relevant SOLD comps but real active-market data exists
  // (the exact bug found auditing HB-0085/86/87: 9-38 active comps sitting unused
  // while confidence/price both said "zero data"), derive a real, honestly-labeled
  // active-market estimate instead of falling straight to the speed-to-sell "no
  // data" narrative. Active-only estimates cap below sold-comp confidence tiers --
  // this is asking-price data, not confirmed sales.
  const usingActiveFallback = filteredComps.length === 0 && relevantActive.length > 0

  const confidenceScore = usingActiveFallback
    ? Math.min(35, calcConfidenceScore(relevantActive.length))
    : calcConfidenceScore(filteredComps.length)

  const prices = usingActiveFallback
    ? relevantActive.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
    : filteredComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPriceCents =
    prices.length === 0
      ? null
      : prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid]
```

- [ ] **Step 2: Reflect the fallback in the sources list passed to methodology generation**

Locate:

```ts
  const sources = [...new Set(filteredComps.map((r) => r.source))]
```

Change to:

```ts
  const sources = usingActiveFallback
    ? [...new Set(relevantActive.map((r) => r.source))]
    : [...new Set(filteredComps.map((r) => r.source))]
```

- [ ] **Step 3: Reflect the fallback in the comp count passed to methodology generation**

Locate the `generatePricingMethodology` call:

```ts
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        filteredComps.length,
        sources,
```

Change to:

```ts
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        usingActiveFallback ? relevantActive.length : filteredComps.length,
        sources,
```

Leave every other argument to `generatePricingMethodology` as-is for this task (Task 8 updates the function itself to phrase the active-fallback case honestly).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. Note: `relevantActive` is already computed earlier in this function (used for `lowestActive`) — this task reuses it, doesn't redefine it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): use active comps for confidence/price when sold comps are zero

HB-0085/86/87 had 9/38/12 real active comps but still showed 20%
confidence and a 'zero comparable sales' narrative, because
confidence/price were computed strictly from sold comps. Active-only
estimates are capped at 35% confidence and clearly distinct from a
sold-comp-backed price -- see Task 8 for the honest methodology text."
```

## Context

This is Task 6, the core fix for the confidence/price bug found auditing the 4 live listings. `relevantActive` (active comps that passed the same LLM relevance filter used for `lowestActive`, computed a few lines earlier in this same function at `:644-647` in the pre-Task-6 file) is reused here rather than recomputed. The `Math.min(35, ...)` cap is a deliberate design choice: active/asking-price data is real signal but should never look as confident as a genuine sold-comp median — 35% keeps it clearly in "low confidence" territory while still being honest that *some* real market data informed the number, unlike the previous unconditional 20%.

---

### Task 7: Apply the relevance filter to active comps before insert

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Insert only relevant active comps, not the full unfiltered set**

Locate:

```ts
  // Insert all: filtered sold comps + active market context
  const toInsert = [...filteredComps, ...activeRows]
```

Change to:

```ts
  // Insert all: filtered sold comps + relevant active market context. activeRows
  // itself stays unfiltered (used above for the lowestActive/relevantActive
  // fallback signal), but only the relevance-filtered subset gets written --
  // HB-0086 had 38 unfiltered active comps, most of them loosely-related Chanel
  // Cambon variants, none of them checked against item+color before this fix.
  const toInsert = [...filteredComps, ...relevantActive]
```

- [ ] **Step 2: Type-check and run tests**

Run: `npx tsc --noEmit && node --import tsx --test src/**/*.test.ts`
Expected: both clean

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): only insert relevance-filtered active comps

activeRows (ebay_active, poshmark_active, therealreal_active,
google_active) previously wrote to pricing_comps completely
unfiltered -- only used the LLM item+color relevance filter to pick
lowestActive, never applied before insert. Now only relevantActive
(the filtered subset) gets written."
```

## Context

This is Task 7. `relevantActive` already exists from the earlier `filterRelevantComps(activeRows, ...)` call (used for `lowestActive` in the current code, and now also for Task 6's confidence fallback) — this task just changes what gets inserted into the DB, reusing the same filtered set rather than computing anything new. This directly targets the HB-0086 case: 38 active comps in the DB today, most likely low-relevance Cambon-line variants that should never have been written.

---

### Task 8: Root-cause and fix the HB-0086 `lowest_active_price_cents` bug

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts` (if a code bug is found)

- [ ] **Step 1: Reproduce against HB-0086's actual data**

HB-0086 (Chanel Cambon wallet, listing id findable via `SELECT id FROM listings WHERE sku='HB-0086'`) has 38 active comps in `pricing_comps` today but a `null` `lowest_active_price_cents`. Before Tasks 6-7 landed, `lowestActive` was computed from `relevantActive = activeRows.filter((_, i) => activeRelevantIndices.has(i))`, where `activeRelevantIndices` comes from `filterRelevantComps(activeRows, ...)` (`:644-646`). `COMP_FILTER_BATCH = 25` (`:456`) means HB-0086's 38 candidates span 2 batches (0-24, 25-37) in that function's internal loop (`:473-510`).

Add a temporary diagnostic (`console.log` the batch count, the raw Claude response text per batch, and `keepIndices.size` before returning) inside `filterRelevantComps`, then manually re-run `runStep3PricingResearch` for HB-0086's listing id (via the retry-step path, or a one-off script) and observe: does the 2nd batch's Claude call fail to parse (the `if (!match) continue` or the inner `try { JSON.parse } catch { continue }` silently skipping a whole batch's worth of indices), or does the whole function hit its outer `catch` and fail open (`return new Set(comps.map((_, i) => i))` — which would make ALL 38 "relevant," not zero, so that's probably NOT what's happening if `lowestActive` came back null)? Given `lowestActive` is `null`, the most likely explanation is `relevantActive.length === 0` — i.e. every batch's Claude call legitimately scored everything below `COMP_RELEVANCE_THRESHOLD = 6` (plausible: 38 candidates from a broad "Chanel Cambon wallet" search, many an actually-different Cambon product line the vision analysis's `notableFeatures` correctly disqualified) — in which case this is **not a bug**, it's the relevance filter correctly rejecting a large batch of poor matches, and `lowestActive` being `null` was the correct behavior all along.

- [ ] **Step 2: Based on what Step 1 finds, do ONE of the following**

- **If it's a genuine parse/batching bug** (a batch's response fails to parse and gets silently dropped instead of retried): fix `filterRelevantComps` to retry a failed-to-parse batch once before giving up on it, or at minimum log the failure instead of silently `continue`-ing, so this is diagnosable in production logs next time. Write the fix, then re-verify against HB-0086.
- **If it's correct behavior** (the relevance filter is legitimately rejecting most/all of the 38 candidates): no code change needed. Document the finding in this task's commit message so it's on record that `lowest_active_price_cents: null` for HB-0086 was investigated and is correct, not a bug — remove the diagnostic logging added in Step 1.

- [ ] **Step 3: Remove any temporary diagnostic logging before committing**

- [ ] **Step 4: Commit**

If a real bug was found and fixed:
```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): <describe the actual root cause found>"
```

If no bug was found (confirmed correct behavior):
```bash
git commit --allow-empty -m "chore(pricing): confirm HB-0086 lowest_active_price_cents=null is correct

Investigated per plan Task 8: filterRelevantComps legitimately scored
all/most of HB-0086's 38 active comps below the relevance threshold
(loosely-related Chanel Cambon variants). Not a bug -- Task 7's
insert-filtering fix means the DB will also stop accumulating those
unfiltered rows going forward."
```

## Context

This is Task 8, a root-cause investigation flagged explicitly in the spec as "not yet pinned down" ahead of time — deliberately scoped as an investigate-then-decide task rather than a pre-determined fix, since the actual cause wasn't confirmed during planning. Do not assume it's a bug and start refactoring `filterRelevantComps` speculatively — reproduce first, per Step 1, and let the evidence decide which branch of Step 2 applies.

---

### Task 9: Update `generatePricingMethodology` for the active-fallback case and drop Mercari

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Add an `isActiveOnly` flag to the function and adjust its prompt**

Change the function signature from:

```ts
async function generatePricingMethodology(
  compCount: number,
  sources: string[],
  suggestedPriceCents: number | null,
  priceToMoveCents: number | null,
  discountPct: number,
  confidenceScore: number,
  retailPriceCents: number | null,
  priceHistory: Array<{ event_type: string; price_cents: number; created_at: string }>,
  apiKeys: ApiKeys
): Promise<string> {
```

to:

```ts
async function generatePricingMethodology(
  compCount: number,
  sources: string[],
  suggestedPriceCents: number | null,
  priceToMoveCents: number | null,
  discountPct: number,
  confidenceScore: number,
  retailPriceCents: number | null,
  priceHistory: Array<{ event_type: string; price_cents: number; created_at: string }>,
  apiKeys: ApiKeys,
  isActiveOnly: boolean
): Promise<string> {
```

Change the prompt line from:

```ts
  const prompt = `In 80–100 words, explain how this resale price was determined. Comp count: ${compCount}. Sources: ${sourcesStr}. Median adjusted price: ${suggestedStr}. Confidence: ${confidenceScore}%. Speed-to-sell price: ${priceToMoveStr} (${Math.round(discountPct * 100)}% below market median, typically sells in days vs weeks at list price).${retailStr}${historyStr} Return only the paragraph, no headings.`
```

to:

```ts
  const dataBasisNote = isActiveOnly
    ? ' IMPORTANT: these are CURRENT ASKING PRICES from active listings, not confirmed sales -- say so explicitly (e.g. "based on N active listings, no confirmed sold comps"), do not describe this as a "market median" or imply any sale has actually occurred at this price.'
    : ''
  const prompt = `In 80–100 words, explain how this resale price was determined. Comp count: ${compCount}. Sources: ${sourcesStr}. Median adjusted price: ${suggestedStr}. Confidence: ${confidenceScore}%. Speed-to-sell price: ${priceToMoveStr} (${Math.round(discountPct * 100)}% below market median, typically sells in days vs weeks at list price).${retailStr}${historyStr}${dataBasisNote} Return only the paragraph, no headings.`
```

- [ ] **Step 2: Pass the flag at the call site**

Change:

```ts
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        usingActiveFallback ? relevantActive.length : filteredComps.length,
        sources,
        suggestedPriceCents,
        priceToMoveCents,
        discountPct,
        confidenceScore,
        retailResult?.retailPriceCents ?? null,
        priceHistory ?? [],
        apiKeys
      )
    : null
```

to:

```ts
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        usingActiveFallback ? relevantActive.length : filteredComps.length,
        sources,
        suggestedPriceCents,
        priceToMoveCents,
        discountPct,
        confidenceScore,
        retailResult?.retailPriceCents ?? null,
        priceHistory ?? [],
        apiKeys,
        usingActiveFallback
      )
    : null
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. `sources` no longer contains any `mercari`/`mercari_active` values as of Task 2's removal, so no separate "drop Mercari from sourcesStr" change is needed here — it already can't appear.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): honest methodology text for the active-comp fallback

When Task 6's active-only fallback is used, the generated paragraph
now explicitly says it's based on current asking prices with no
confirmed sales, instead of implying a sold-comp market median."
```

## Context

This is Task 9, completing Tasks 6-7's fix by making the AI-generated explanation text match reality. Without this, a listing using the new active-comp fallback would get a *higher* confidence and a *real* price (good), but the generated paragraph would still describe it using the same "market median" language that implies confirmed sales — misleading in a different way than the original bug. `isActiveOnly` is threaded through as an explicit boolean rather than re-derived inside the function, keeping `generatePricingMethodology` a pure function of its inputs.

---

### Task 10: Replace-on-regen — delete existing comps before inserting new ones

**Files:**
- Modify: `src/lib/pipeline/step3-pricing-research.ts`

- [ ] **Step 1: Delete existing `pricing_comps` rows for this listing before inserting**

Locate:

```ts
  // Insert all: filtered sold comps + relevant active market context. activeRows
  // itself stays unfiltered (used above for the lowestActive/relevantActive
  // fallback signal), but only the relevance-filtered subset gets written --
  // HB-0086 had 38 unfiltered active comps, most of them loosely-related Chanel
  // Cambon variants, none of them checked against item+color before this fix.
  const toInsert = [...filteredComps, ...relevantActive]
  if (toInsert.length > 0) {
    const { error } = await supabase.from('pricing_comps').insert(toInsert)
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
  }
```

Change to:

```ts
  // Insert all: filtered sold comps + relevant active market context. activeRows
  // itself stays unfiltered (used above for the lowestActive/relevantActive
  // fallback signal), but only the relevance-filtered subset gets written --
  // HB-0086 had 38 unfiltered active comps, most of them loosely-related Chanel
  // Cambon variants, none of them checked against item+color before this fix.
  const toInsert = [...filteredComps, ...relevantActive]
  // Replace-on-regen: a re-run (fresh intake or a manual retry) must not accumulate
  // comps on top of a prior run's rows -- HB-0086/HB-0087 each show multiple insert
  // batches from re-runs minutes apart, confirmed during investigation. Delete this
  // listing's existing rows before writing the new batch, every time.
  const { error: deleteError } = await supabase.from('pricing_comps').delete().eq('listing_id', listingId)
  if (deleteError) {
    throw new Error(`step3: pricing_comps delete-before-insert failed — ${deleteError.message}`)
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('pricing_comps').insert(toInsert)
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
  }
```

- [ ] **Step 2: Type-check and run tests**

Run: `npx tsc --noEmit && node --import tsx --test src/**/*.test.ts`
Expected: both clean

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "fix(pricing): replace-on-regen instead of accumulating comps

Confirmed during investigation: HB-0086 and HB-0087 each have
multiple ebay_active insert batches from step3 running more than once
minutes apart, purely additive. Every run now deletes the listing's
existing pricing_comps rows before inserting the new batch."
```

## Context

This is Task 10. This is an unconditional behavior change to every call of `runStep3PricingResearch`, not just a new "regenerate" tool — matches Joe's explicit decision in the spec ("Yes, replace on regen"). The delete-then-insert is two separate statements (not a transaction), matching this codebase's existing best-effort style elsewhere (e.g. `pushPipelineStep` itself is a single best-effort `.update()` with no rollback). If the insert fails after a successful delete, the listing temporarily has zero comps rather than stale/duplicated ones — an accepted tradeoff per the spec's Error Handling section, not an oversight.

---

### Task 11: Poshmark cookie format validation on save

**Files:**
- Modify: `src/app/api/settings/platform/route.ts`

- [ ] **Step 1: Add a format check for `poshmark_cookies` specifically**

Change:

```ts
  if (typeof value !== 'string' || value.trim() === '') {
    return Response.json({ error: 'value must be a non-empty string' }, { status: 400 })
  }

  try {
    await setSetting(user.id, key, value.trim(), 'credential')
```

to:

```ts
  if (typeof value !== 'string' || value.trim() === '') {
    return Response.json({ error: 'value must be a non-empty string' }, { status: 400 })
  }

  const trimmedValue = value.trim()

  // The Poshmark cookie field expects a real browser Cookie header (name=value; name2=value2; ...).
  // A JWT-shaped or otherwise pair-less value sat here for months, silently returning zero
  // comps/notifications with no visible error anywhere -- reject it at save time instead.
  if (key === 'poshmark_cookies' && (!trimmedValue.includes('=') || !trimmedValue.includes(';'))) {
    return Response.json({
      error: 'This doesn\'t look like a valid cookie string (expected "name=value; name2=value2" pairs). ' +
        'Log into poshmark.com, open DevTools → Network, click any poshmark.com request, and copy the full Cookie request header value.',
    }, { status: 400 })
  }

  try {
    await setSetting(user.id, key, trimmedValue, 'credential')
```

- [ ] **Step 2: Update the remaining reference to `value.trim()` to use the new variable**

Confirm the `setSetting` call inside the `try` block now reads `trimmedValue` (shown in Step 1's replacement) rather than `value.trim()` — this avoids re-computing the same trim twice, no behavior change.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Manually verify**

Re-read the full modified file and confirm the validation only applies to `key === 'poshmark_cookies'` — every other platform credential key must be unaffected (no new validation on eBay/Etsy/Reddit/Mercari fields).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/platform/route.ts
git commit -m "fix(settings): reject malformed Poshmark cookie strings on save

The stored poshmark_cookies value was JWT-shaped with no semicolon/
equals-sign pairs -- not a real browser cookie string -- and had been
silently broken for ~3 months. Validate the shape at save time."
```

## Context

This is Task 11. `PLATFORM_SETTING_KEYS` (imported from `@/lib/user-settings`) already includes `poshmark_cookies` as a valid key — this task only adds a shape check specific to that one key, not a new validation framework. `setSetting`'s signature (`userId, key, value, type`) is unchanged.

---

### Task 12: Credential health-check — eBay + Poshmark live probes

**Files:**
- Create: `src/app/api/settings/platform/health-check/route.ts`
- Modify: `src/components/settings/PlatformSettings.tsx`

- [ ] **Step 1: Create the health-check endpoint**

```ts
// src/app/api/settings/platform/health-check/route.ts
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { getEbayAppToken, EBAY_SCOPE_BASE } from '@/lib/pipeline/comps/ebay-oauth'

type HealthStatus = 'valid' | 'invalid' | 'unreachable' | 'not_configured'

async function checkPoshmark(userId: string): Promise<HealthStatus> {
  const cookies = await getSetting(userId, 'poshmark_cookies')
  if (!cookies) return 'not_configured'
  if (!cookies.includes('=') || !cookies.includes(';')) return 'invalid'
  try {
    const params = new URLSearchParams({
      app_version: '2.55', count: '1', max_id: '0', q: 'test',
      sort_by: 'best_match', availability: 'available', summarize: 'true', _: Date.now().toString(),
    })
    const res = await fetch(`https://poshmark.com/vm-rest/posts?${params}`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? 'valid' : 'invalid'
  } catch {
    return 'unreachable'
  }
}

async function checkEbay(): Promise<HealthStatus> {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return 'not_configured'
  try {
    const token = await getEbayAppToken(EBAY_SCOPE_BASE)
    return token ? 'valid' : 'invalid'
  } catch {
    return 'unreachable'
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [poshmark, ebay] = await Promise.all([checkPoshmark(user.id), checkEbay()])
  return Response.json({ poshmark, ebay })
}
```

- [ ] **Step 2: Surface the status in `PlatformSettings.tsx`**

Add a new client-side health-check display component. In `src/components/settings/PlatformSettings.tsx`, add this component near the top (after the `OAuthButton` function, before `TextSettingRow`):

```tsx
function HealthBadge({ platformId }: Readonly<{ platformId: string }>) {
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'unreachable' | 'not_configured' | 'unsupported'>('loading')

  useState(() => {
    if (platformId !== 'poshmark' && platformId !== 'ebay') {
      setStatus('unsupported')
      return
    }
    fetch('/api/settings/platform/health-check')
      .then((r) => r.json())
      .then((data: { poshmark: string; ebay: string }) => {
        setStatus((platformId === 'poshmark' ? data.poshmark : data.ebay) as typeof status)
      })
      .catch(() => setStatus('unreachable'))
  })

  if (status === 'unsupported' || status === 'loading') return null

  const labels: Record<string, { text: string; className: string }> = {
    valid: { text: '✅ Connection valid', className: 'text-emerald-500' },
    invalid: { text: '❌ Invalid credential', className: 'text-red-400' },
    unreachable: { text: '⚠️ Could not verify', className: 'text-amber-500' },
    not_configured: { text: '— Not configured', className: 'text-gray-600' },
  }
  const label = labels[status]

  return <p className={`text-[10px] ${label.className}`}>{label.text}</p>
}
```

Then in the `PlatformSection` component, add `<HealthBadge platformId={platform.id} />` immediately after the closing `</div>` of the header block (right before the `{callbackUrl && (` conditional), so it renders once per platform section for the two supported platforms.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. Note: `useState(() => {...})` as a mount-effect substitute (no `useEffect` import currently in this file) — if `tsc`/lint flags this as unconventional, use `useEffect` instead and add the import; either is acceptable, prefer whichever keeps the diff smaller once you see the actual lint output.

- [ ] **Step 4: Manually verify**

No live dev server available to a subagent — skip interactive verification, re-read both files to confirm: the health-check route only checks Poshmark/eBay (per spec, Mercari has no check since it's being dropped as a source), and `HealthBadge` renders nothing for every other platform (`etsy`, `mercari`, `reddit`).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/platform/health-check/route.ts src/components/settings/PlatformSettings.tsx
git commit -m "feat(settings): add live credential health-check for eBay + Poshmark

Surfaces the exact diagnostic run manually during investigation (a
live OAuth mint check for eBay, a live authenticated search for
Poshmark) as a UI-visible status, so a stale/malformed credential
doesn't silently rot for months undetected again."
```

## Context

This is Task 12. The Poshmark probe intentionally reuses the exact validation Task 11 already does inline, plus an additional live network call — a value can be well-formed (passes Task 11's save-time check) but still be an expired/revoked cookie, which only a live probe catches. The eBay probe reuses `getEbayAppToken` (already exists, `src/lib/pipeline/comps/ebay-oauth.ts:42-57`) exactly as it was used for the live diagnostic during planning — no new eBay-side code needed, just wiring it into a route.

---

### Task 13: URL-verification module (comp identity + sold/active reclassification)

**Files:**
- Create: `src/lib/pipeline/comps/url-verify.ts`

- [ ] **Step 1: Write the verification function**

```ts
// src/lib/pipeline/comps/url-verify.ts

// Best-effort: confirms a candidate comp's listing_url actually shows the claimed
// item, and for TheRealReal/Poshmark specifically, whether the page shows a "Sold"
// badge (reclassify as a genuine sold comp) or is still live (stays active). Any
// fetch failure or ambiguous page content leaves the comp in its default
// classification rather than blocking the pipeline on one slow/broken page.
export interface VerifiableComp {
  source: string
  title: string
  listing_url: string
}

export interface VerificationResult {
  identityConfirmed: boolean
  soldConfirmed: boolean
}

const SOLD_BADGE_PATTERNS: Record<string, RegExp> = {
  therealreal_active: /class="[^"]*sold[^"]*"|>\s*Sold\s*</i,
  poshmark_active: /"availability"\s*:\s*"sold_out"|>\s*Sold\s*</i,
}

export async function verifyComp(comp: VerifiableComp, brand: string): Promise<VerificationResult> {
  if (!comp.listing_url) return { identityConfirmed: false, soldConfirmed: false }
  try {
    const res = await fetch(comp.listing_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { identityConfirmed: false, soldConfirmed: false }
    const html = await res.text()

    const identityConfirmed = html.toLowerCase().includes(brand.toLowerCase())

    const soldPattern = SOLD_BADGE_PATTERNS[comp.source]
    const soldConfirmed = soldPattern ? soldPattern.test(html) : false

    return { identityConfirmed, soldConfirmed }
  } catch {
    return { identityConfirmed: false, soldConfirmed: false }
  }
}

// Verifies a bounded sample (not every comp -- a full fetch-every-comp pass proved
// too slow/rate-limited in early testing) and returns which indices should be
// reclassified from source X_active to a genuine sold comp.
export async function verifyAndReclassify<T extends VerifiableComp & { sold_at: string | null }>(
  comps: T[],
  brand: string,
  sampleSize = 10
): Promise<Set<number>> {
  const candidates = comps
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.source === 'therealreal_active' || c.source === 'poshmark_active')
    .slice(0, sampleSize)

  const reclassify = new Set<number>()
  await Promise.all(
    candidates.map(async ({ c, i }) => {
      const result = await verifyComp(c, brand)
      if (result.identityConfirmed && result.soldConfirmed) reclassify.add(i)
    })
  )
  return reclassify
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (new file, no call sites yet — Task 14 wires it in as part of the report-first tooling, where it's most natural to run this bounded/best-effort check)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/comps/url-verify.ts
git commit -m "feat(pricing): add best-effort comp URL verification

Confirms a candidate comp's listing_url actually shows the claimed
item, and for TheRealReal/Poshmark whether it shows a persisted Sold
badge (both sites keep sold listings live rather than taking them
down, confirmed during planning research) -- only a live page fetch
can tell sold from active-for-sale, a bare search snippet can't."
```

## Context

This is Task 13. This module is deliberately generic (takes `comps`/`brand`, not tied to `runStep3PricingResearch`'s internal types) so it can be called from the report-first regeneration tooling in Task 14 without a circular import. `SOLD_BADGE_PATTERNS` are best-guess regex based on typical badge/availability markup for these sites — if Task 14's manual verification against real archived-catalog items shows these patterns don't reliably match either site's actual current HTML, adjust them then (this is exactly the kind of thing that needs testing against real pages, not something to over-engineer speculatively here).

---

### Task 14: Report-first regeneration tooling

**Files:**
- Create: `src/lib/pipeline/regenerate-comps.ts`
- Create: `src/app/api/pipeline/regenerate-comps/route.ts`
- Modify: `src/lib/inngest/functions/retry-step.ts`

- [ ] **Step 1: Extract a preview-mode variant of the comp-gathering logic**

This is the largest task in the plan and the one most likely to need judgment calls during implementation — `runStep3PricingResearch` (as it stands after Tasks 1-10) does gathering, filtering, DB writes, and methodology generation all in one function with no preview/dry-run switch. Rather than duplicate all of that logic, refactor `runStep3PricingResearch` to separate "compute everything" from "write everything," so both the real pipeline run and the new preview tool call the same computation path:

```ts
// src/lib/pipeline/regenerate-comps.ts
import { getSupabaseAdmin } from './supabase-push'
import type { VisionAnalysis } from './step2-vision-analysis'
import type { ApiKeys } from '@/lib/user-api-keys'
import { verifyAndReclassify } from './comps/url-verify'

export interface RegeneratePreview {
  listingId: string
  sku: string
  thumbnailUrl: string | null
  proposedComps: Array<{
    source: string
    title: string
    price: string
    soldAt: string | null
    listingUrl: string
  }>
  proposedSuggestedPriceCents: number | null
  proposedConfidenceScore: number
  proposedMethodology: string | null
}

// Renders a markdown report for a set of listing ids WITHOUT writing to the DB.
// Confirm mode (a separate call) re-runs the real runStep3PricingResearch for each
// listing (which now includes Task 10's replace-on-regen delete) once the report
// is reviewed and approved.
export async function buildRegenerateReport(
  listingIds: string[]
): Promise<{ markdown: string; previews: RegeneratePreview[] }> {
  const supabase = getSupabaseAdmin()
  const previews: RegeneratePreview[] = []

  for (const listingId of listingIds) {
    const { data: listing } = await supabase
      .from('listings')
      .select('sku, suggested_price_cents, confidence_score, pricing_methodology, brand')
      .eq('id', listingId)
      .single()
    if (!listing) continue

    const { data: photo } = await supabase
      .from('photos')
      .select('raw_url, processed_url')
      .eq('listing_id', listingId)
      .eq('type', 'studio')
      .limit(1)
      .maybeSingle()

    const { data: comps } = await supabase
      .from('pricing_comps')
      .select('source, title, sale_price_cents, sold_at, listing_url')
      .eq('listing_id', listingId)
      .order('adjusted_price_cents')

    // Reclassify any therealreal_active/poshmark_active row that a live page fetch
    // confirms is actually sold -- best-effort, bounded sample (see url-verify.ts).
    // This only affects what the REPORT displays; it does not write back to
    // pricing_comps here (that's step3's job on its next real run, via Task 7's
    // insert path -- flag to Joe if the report needs to trigger a DB correction
    // directly instead of waiting for the next regen).
    const compsForVerification = (comps ?? []).map((c) => ({
      source: c.source as string,
      title: c.title as string,
      listing_url: c.listing_url as string,
      sold_at: c.sold_at as string | null,
    }))
    const reclassifiedIndices = await verifyAndReclassify(compsForVerification, (listing.brand as string) ?? '')

    previews.push({
      listingId,
      sku: (listing.sku as string) ?? listingId,
      thumbnailUrl: (photo?.processed_url as string | null) ?? (photo?.raw_url as string | null) ?? null,
      proposedComps: compsForVerification.map((c, i) => ({
        source: reclassifiedIndices.has(i) ? c.source.replace(/_active$/, '') : c.source,
        title: c.title,
        price: `$${((comps?.[i]?.sale_price_cents as number) / 100).toFixed(0)}`,
        soldAt: reclassifiedIndices.has(i) && !c.sold_at ? 'confirmed via URL check' : c.sold_at,
        listingUrl: c.listing_url,
      })),
      proposedSuggestedPriceCents: listing.suggested_price_cents as number | null,
      proposedConfidenceScore: (listing.confidence_score as number | null) ?? 0,
      proposedMethodology: listing.pricing_methodology as string | null,
    })
  }

  const markdown = previews
    .map((p) => {
      const priceStr = p.proposedSuggestedPriceCents != null
        ? `$${(p.proposedSuggestedPriceCents / 100).toFixed(0)}`
        : 'N/A'
      const thumb = p.thumbnailUrl ? `![${p.sku}](${p.thumbnailUrl})\n\n` : ''
      const compsList = p.proposedComps.length > 0
        ? p.proposedComps.map((c) => `- ${c.source}: "${c.title}" — ${c.price}${c.soldAt ? ` (sold ${c.soldAt})` : ''} — ${c.listingUrl}`).join('\n')
        : '_No comps_'
      return `## ${p.sku}\n\n${thumb}**Suggested price:** ${priceStr} (${p.proposedConfidenceScore}% confidence)\n\n**Methodology:** ${p.proposedMethodology ?? 'N/A'}\n\n**Comps:**\n${compsList}\n`
    })
    .join('\n---\n\n')

  return { markdown, previews }
}
```

Note: this reads the CURRENT DB state (post a real `runStep3PricingResearch` run) rather than re-implementing step3's computation inline — the simplest correct "preview" for this task is: trigger the real pipeline run (which, per Task 10, already replaces rather than accumulates), then render a report from what it wrote, and require an explicit human "looks right" before treating that as final. If true zero-DB-write preview (computing without writing at all) turns out to be a hard requirement once you're implementing this, that needs `runStep3PricingResearch` split into a compute-only core + a thin write wrapper — flag that back to Joe as a design question if the read-after-write approach here doesn't actually satisfy "report-first" in practice, don't silently reinterpret the requirement.

- [ ] **Step 2: Create the API route**

```ts
// src/app/api/pipeline/regenerate-comps/route.ts
import { createClient } from '@/lib/supabase/server'
import { buildRegenerateReport } from '@/lib/pipeline/regenerate-comps'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { listingIds?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.listingIds) || body.listingIds.some((id) => typeof id !== 'string')) {
    return Response.json({ error: 'listingIds must be an array of strings' }, { status: 400 })
  }

  const { markdown, previews } = await buildRegenerateReport(body.listingIds as string[])
  return Response.json({ markdown, previews })
}
```

- [ ] **Step 3: Fix `retry-step.ts`'s degraded context so a re-run has real matching quality**

In `src/lib/inngest/functions/retry-step.ts`, change:

```ts
    const step2Partial = {
      brand: (listing.brand as string) ?? '',
      category: listing.category,
      condition: listing.condition,
      conditionNotes: '',
      notableFeatures: [],
      isLuxury: listing.is_luxury as boolean,
      inclusions: [],
      photoPlan: [],
      confidenceNote: '',
    }
```

to also select and thread through `intake_meta`'s vision-analysis features (the same source `gate-messages.ts`'s `notableFeaturesOf` helper reads from) — update the `.select(...)` call earlier in the function:

```ts
    const { data: listing } = await supabase
      .from('listings')
      .select(
        'user_id, category, brand, condition, is_luxury, suggested_price_cents, intake_meta'
      )
      .eq('id', listingId)
      .single()
```

(already selects `intake_meta` — no change needed there), then change the `step2Partial` construction to:

```ts
    const notableFeatures = ((listing.intake_meta as { visionAnalysis?: { notable_features?: string[] } } | null)
      ?.visionAnalysis?.notable_features) ?? []

    const step2Partial = {
      brand: (listing.brand as string) ?? '',
      category: listing.category,
      condition: listing.condition,
      conditionNotes: '',
      notableFeatures,
      isLuxury: listing.is_luxury as boolean,
      inclusions: [],
      photoPlan: [],
      confidenceNote: '',
    }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 5: Manually verify**

No live dev server for a subagent — re-read `regenerate-comps.ts`/`route.ts` to confirm no write path exists anywhere in the preview flow (only `.select()` calls), and re-read the `retry-step.ts` diff to confirm `notableFeatures` is correctly extracted from the same `intake_meta.visionAnalysis.notable_features` shape used elsewhere in the codebase (`gate-messages.ts`'s `notableFeaturesOf`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/regenerate-comps.ts src/app/api/pipeline/regenerate-comps/route.ts src/lib/inngest/functions/retry-step.ts
git commit -m "feat(pricing): report-first regeneration endpoint + fix retry-step context loss

buildRegenerateReport renders a markdown report (with thumbnail) from
a listing's current pricing_comps/suggested_price_cents for review.
retry-step.ts no longer reconstructs an empty notableFeatures array on
manual retry -- it now reads the same intake_meta.visionAnalysis data
a fresh intake run would have, so a step-3 retry has real matching
quality instead of a brand-only search."
```

## Context

This is Task 14, the largest and most judgment-dependent task in the plan — flagged as such in Step 1. `getSupabaseAdmin`/`pushPipelineStep` already exist in `./supabase-push` (`src/lib/pipeline/supabase-push.ts`, unchanged) and are reused, not reimplemented. This task deliberately does NOT attempt a full zero-write dry-run computation (which would require splitting `runStep3PricingResearch` into compute/write halves, a larger refactor not clearly justified yet) — it takes the simpler "trust replace-on-regen (Task 10), read back what was written, present that as the report" approach, and explicitly calls out in Step 1 that this should be escalated back to Joe as a real design question if it doesn't actually satisfy what he meant by "report-first," rather than silently declared sufficient.

---

## Verification

- [ ] Run the full suite and type-check: `npx tsc --noEmit && node --import tsx --test src/**/*.test.ts` — clean.
- [ ] Trigger a real pipeline re-run (via the fixed `retry-step.ts` path, step 3) against HB-0084, HB-0085, HB-0086, HB-0087 and confirm via `psql`:
  - HB-0085/86/87: `suggested_price_cents` traces to a comps-derived number (not step4a's independent guess — check it's stable/sane relative to the comps actually present), confidence is no longer a flat 20% with "zero comparable sales" language when active comps exist.
  - HB-0086 specifically: `lowest_active_price_cents` behavior matches whatever Task 8 concluded (either non-null now, or confirmed-correctly-null).
  - HB-0084: still correctly falls back to the lowest-confidence path (genuinely zero comps from every source, including the two new ones) — this is the one listing where "no data" is the honest answer.
  - No listing's `pricing_methodology` text mentions Mercari.
  - `pricing_comps` for each of the 4 has no duplicate insert batches from prior runs (Task 10's replace-on-regen).
- [ ] Call `buildRegenerateReport` (via the new route or directly) for a small slice of archived listings, including any pair Joe identifies as intentional duplicates of the same physical item, and manually compare the reports for consistency.
- [ ] Confirm `/api/settings/platform/health-check` reports `invalid` for the current (unfixed) Poshmark cookie, then `valid` after Joe re-pastes a real one (manual step on Joe's side, per the spec).
- [ ] `bd close ai-listings-b26` once Joe confirms the live-listing results look right; leave `ai-listings-kni`-style follow-ups filed for anything discovered during Task 8's investigation or Task 14's report-first design question that needs a separate pass.
- [ ] `git push`, open a PR, drive it through review per the repo's standing PR-autonomy convention.
