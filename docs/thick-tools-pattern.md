# Thick Tools Pattern

Design guide for the listing engine's conversational agent tool layer.

---

## The principle

A tool call that returns raw data is a context leak. Every token of intermediate data the agent sees is a token it must process, attend over, and carry forward. For a conversational agent that may call 4–6 tools per user message, this compounds fast.

The fix: **thick tools**. Each tool aggregates server-side and returns one clean structured object. The agent receives a decision-ready summary — not rows to reason over.

mcp-exec applies this pattern at the MCP layer: `exec()` runs an entire multi-step workflow in a sandbox and returns only the final output. We apply the same pattern to the listing engine's own tool layer.

```
❌ Thin tools — context leak
agent → query_pricing_comps()  → 15 raw rows in context
agent → search_ebay()          → 20 listings in context
agent → analyze_condition()    → condition report in context
agent now has ~4,000 tokens of intermediate state to reason over

✅ Thick tool — clean summary
agent → research_pricing(listingId) → { suggestedPrice, confidence, comps, evidence }
agent has ~200 tokens, one decision to make
```

---

## Tool design rules

1. **Inputs are identifiers or narrow params** — not raw data.
   - `research_pricing(listingId: string)` ✅
   - `research_pricing(comps: Comp[], currentPrice: number)` ❌ — caller pre-processes

2. **Outputs are typed structured objects** — never `any[]` or raw query results. Always define a TypeScript interface for the return type. Include confidence scores and evidence where the agent needs to reason about reliability.

3. **One tool call = one decision** the agent can make. If the agent needs two tool results to make one decision, merge the tools.

4. **Error shape lets the agent recover gracefully.** Return `{ ok: false, reason: string }` rather than throwing for recoverable errors. Throw only for unrecoverable failures (DB down, auth expired).

---

## Listing engine examples

### `research_pricing(listingId)`

Agent question: *"What should I price this at?"*

Tool does server-side: query pricing DB + run eBay sold search + condition analysis + weighted median calculation.

```typescript
interface PricingResearch {
  ok: true;
  suggestedPrice: number;
  confidence: 'high' | 'medium' | 'low';
  comps: Array<{
    price: number;
    condition: string;
    source: 'ebay' | 'poshmark' | 'mercari' | 'internal';
    soldDaysAgo: number;
  }>;
  evidence: string; // e.g. "Median of 12 sold comps, good condition"
}

interface PricingResearchError {
  ok: false;
  reason: string; // e.g. "Not enough comps (2 found, need 5)"
}

type PricingResearchResult = PricingResearch | PricingResearchError;
```

### `check_authenticity(listingId, category)`

Agent question: *"Does this pass authentication?"*

Tool does server-side: category-specific checklist lookup + flag analysis + image scan results.

```typescript
interface AuthenticityCheck {
  ok: true;
  passed: boolean;
  confidence: 'high' | 'medium' | 'low';
  flags: string[]; // e.g. ["stitching inconsistency", "logo placement off-center"]
  checklist: Array<{
    item: string;
    passed: boolean;
    required: boolean; // required items failing = automatic fail
  }>;
}

type AuthenticityCheckResult = AuthenticityCheck | { ok: false; reason: string };
```

### `build_description(listingId)`

Agent question: *"Write the listing description."*

Tool does server-side: SEO keyword research + description generation + tone matching for category.

```typescript
interface ListingDescription {
  ok: true;
  description: string;
  seoKeywords: string[];
  tone: 'luxury' | 'casual' | 'technical' | 'streetwear';
  characterCount: number;
  platforms: Array<{
    platform: 'ebay' | 'poshmark' | 'mercari';
    description: string;
    characterCount: number;
  }>;
}

type ListingDescriptionResult = ListingDescription | { ok: false; reason: string };
```

---

## Anti-patterns

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| Tool returns raw DB rows | Agent sees 15 rows, burns context reasoning over them | Aggregate — return a typed summary |
| Three tools for one decision | Each call adds tokens; agent accumulates state across calls | Merge into one thick tool |
| Agent does the aggregation | Logic leaks into the prompt; cannot be unit tested | Move aggregation into the tool |
| `any[]` return type | No contract; agent cannot predict shape | Define a TypeScript interface |
| Throw on recoverable errors | Agent crashes instead of retrying | Return `{ ok: false, reason }` |

---

## TypeScript implementation pattern

```typescript
// Where aggregation logic lives:
//   Inngest job → for async pipeline steps (identification, full research runs)
//   Inline service function → for synchronous agent tool calls

export async function researchPricing(
  listingId: string
): Promise<PricingResearchResult> {
  const listing = await db.listings.findById(listingId);
  if (!listing) return { ok: false, reason: `Listing ${listingId} not found` };

  const [dbComps, ebayResults, condition] = await Promise.all([
    pricingDb.getComps(listing.category, listing.brand, listing.size),
    ebay.searchSold({ query: `${listing.brand} ${listing.model}`, condition: listing.condition }),
    conditionService.analyze(listingId),
  ]);

  const allComps = mergeAndDedup([...dbComps, ...ebayResults]);
  if (allComps.length < 3) {
    return { ok: false, reason: `Not enough comps (${allComps.length} found, need 3)` };
  }

  const suggested = weightedMedian(allComps, condition);

  return {
    ok: true,
    suggestedPrice: suggested.price,
    confidence: suggested.confidence,
    comps: allComps.slice(0, 5), // top 5 — agent doesn't need all of them
    evidence: buildEvidence(suggested, condition, allComps.length),
  };
}
```

---

## The rule of thumb

> If the agent would need to read more than 3 tool results to make one decision, those results should be combined into a single thick tool.

When in doubt, ask: *"Could a human make this decision from just this tool's output?"* If yes, the tool is thick enough. If no, it's returning too much raw data.

---

## Reference

- [mcp-exec DEVELOPER.md](https://github.com/joeblackwaslike/mcp-exec/blob/main/docs/DEVELOPER.md) — the canonical reference for this pattern and server-side aggregation philosophy
- [mcp-exec README](https://github.com/joeblackwaslike/mcp-exec) — how mcp-exec applies this pattern at the MCP layer via `exec()`
