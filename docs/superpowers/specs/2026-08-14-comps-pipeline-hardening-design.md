# Comps Pipeline Hardening — Design Spec

**Date:** 2026-08-14
**Status:** Approved
**Derived from:** design conversation 2026-08-14 (plan-mode investigation), bd issue `ai-listings-b26`, consolidates `ai-listings-r4o` + `ai-listings-0g5` (both closed, superseded), supersedes `ai-listings-9nh` (closed, not pursuing the OAuth path)

---

## What This Builds

Auditing the 4 currently-live listings (HB-0084 through HB-0087) surfaced that the comps/pricing pipeline has several real, verified defects — not the stale assumptions the original bd issues were filed against 7 weeks ago. This spec fixes them, adds two new working comp sources, and adds report-first regeneration tooling so future pricing changes get reviewed before they hit the DB.

**The headline bug, and the reason pricing looks "weird":** `runStep4aDraftListing` (`src/lib/pipeline/step4a-draft-listing.ts:196`) unconditionally overwrites `listings.suggested_price_cents` with a price Claude free-generates as part of drafting the listing description — regardless of whether `runStep3PricingResearch` already computed a real, comps-grounded price (or correctly left it `null` for zero comps). Every listing that finishes the intake pipeline ends up with a `suggested_price_cents` that was **never actually the comps-median calculation** — it's always step4a's independent LLM guess. This is why `confidence_score` can honestly say "20%, no comparable sales" while `suggested_price_cents` still looks like a normal, confident number: the two fields come from two different, uncoordinated LLM calls, and the second one always wins.

Everything else in this spec (dead sources, missing active-comp fallback, missing sold sources) matters because it's what step3 *should* be producing — but none of it reaches the user today, because step4a overwrites it moments later regardless.

**Done when:**
- Step4a no longer silently discards a real, non-null step3 price. Re-running the pipeline against HB-0085/86/87 produces a `suggested_price_cents` that traces back to comps, not an ungrounded LLM guess.
- Zero-sold-comp listings with real active-market data (HB-0085/86/87 today) get an honest, active-comp-informed confidence and methodology, not a canned "zero data" narrative.
- HB-0086's `lowest_active_price_cents` bug is fixed.
- Mercari's dead comp fetchers are removed; TheRealReal's existing (unused) sold-comp search and a new SerpAPI-based eBay sold-listings source are wired in.
- Report-first regeneration tooling exists, with per-item thumbnails, replace-on-regen semantics, and has been run against a slice of the archived catalog (including Joe's intentional duplicate-listing pairs) as a validation corpus before being pointed at the live catalog.
- `ai-listings-9nh` stays closed with today's research recorded; the underlying goal (eBay sold data) is met a different way.

---

## Architecture

No new services or major structural changes — this is a hardening pass on the existing `step3-pricing-research.ts` / `step4a-draft-listing.ts` pair plus two new source fetchers following the file's existing fetcher pattern (`fetchXComps(query, apiKey) => Array<{...}>`, each independently try/catch-wrapped, never throwing).

The core architectural fix is a **precedence rule**: step3's comps-derived price (including `null` when there are no comps) is authoritative. Step4a's own `suggested_price_cents` output is used only as a fallback when step3's is `null`, never to override a real step3 value. This changes step4a from "always write my own guess" to "only fill the gap step3 left."

The confidence/methodology fallback (using active comps when sold comps are zero) lives entirely inside `runStep3PricingResearch` — no change to step4a needed for that part beyond consuming step3's now-more-complete `suggested_price_cents`.

Report-first regeneration is a new thin script/endpoint layered on top of the existing `runStep3PricingResearch`, not a rewrite of it: it calls the same function in a "collect, don't insert" mode (parameterized), renders a markdown report, and only calls the real insert path after explicit confirmation.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|-----------------|
| `src/lib/pipeline/step4a-draft-listing.ts` | Modify | Stop unconditionally overwriting `suggested_price_cents`; only use `draft.suggested_price_cents` when the incoming `suggestedPriceCents` param is `null` |
| `src/lib/agent/tools.ts` | Modify | Same precedence fix in `buildDescription()` (mirrors step4a's pattern, same class of bug — verify during implementation whether it independently sets a price anywhere) |
| `src/lib/pipeline/step3-pricing-research.ts` | Modify | Active-comp confidence/price fallback; item+color filter extended to active comps before insert; remove `fetchMercariSoldComps`/`fetchMercariActiveFloor`/`MERCARI_CONSUMER_API`; add `fetchEbaySoldComps` (SerpAPI `engine=ebay`) and a TheRealReal fetcher call; fix the `lowestActive` computation bug (HB-0086 class); `generatePricingMethodology` source-list no longer implies Mercari; replace-on-regen delete-before-insert |
| `src/lib/platforms/adapters/mercari.ts` | Modify | Stop `CONSUMER_API`/`api.mercari.com` from being relied on for comps (leave `SHOPS_API` alone — different product, unaffected) |
| `src/lib/platforms/adapters/therealreal.ts` | No change (or minor) | `TheRealRealAdapter.searchSoldComps()` already works — reused as-is or lightly adapted to step3's fetcher shape |
| `src/lib/pipeline/comps/serpapi-ebay.ts` | Create | New `fetchEbaySoldComps(query, apiKey)` — SerpAPI `engine=ebay`, `show_only=Sold`/`Complete`, maps `sold_date`→`sold_at`; explicit timeout + graceful-empty-return given observed `503`/timeout flakiness |
| `src/lib/pipeline/comps/url-verify.ts` | Create | Fetches a candidate comp's `listing_url`, confirms item identity and (for TheRealReal/Poshmark) sold-vs-active badge state; best-effort/sampled |
| `src/lib/user-settings.ts` | Modify | Add credential format validation helper (Poshmark cookie shape check) |
| `src/app/api/settings/platforms/health-check` (or similar) | Create | Live probe endpoint per credentialed source (eBay, Poshmark), returns valid/invalid/unreachable |
| `src/components/settings/PlatformSettings.tsx` | Modify | Surface health-check status per platform |
| `src/app/api/pipeline/regenerate-comps` (or similar) | Create | Report-first regeneration endpoint/script: preview mode (no DB write, markdown report with thumbnail) + confirm mode (replace-on-regen insert) |
| `src/app/api/pipeline/retry-step/route.ts`, `src/lib/inngest/functions/retry-step.ts` | Modify | Fix the degraded manual retry path (currently loses `notableFeatures`/color hints, empty `titleForComps`) as part of the regeneration tooling |
| `pricing_comps` table | No schema change | Replace-on-regen deletes existing rows for a listing before the new insert — application-level, not a migration |

---

## Data Flow

**Step3 → Step4a price precedence (the headline fix)**

1. `runStep3PricingResearch` computes `suggestedPriceCents` as today (median of filtered sold comps, or the new active-comp fallback when sold comps are zero — see below), writes it via `pushPipelineStep`.
2. `intake-pipeline.ts` re-fetches `suggested_price_cents` from the listing row (already does this, `:144-148`) and passes it into `runStep4aDraftListing` as `suggestedPriceCents: number | null`.
3. Inside step4a, after `runStructured` returns `draft` (which still includes Claude's own `suggested_price_cents` — the schema field stays, since step4a needs *some* estimate to reference in the generated description copy when step3 found nothing): the value written to the DB becomes `suggestedPriceCents ?? draft.suggested_price_cents` — step3's real number wins whenever it exists; Claude's guess is used only to fill a genuine gap.
4. `agent/tools.ts`'s `buildDescription()` — verify during implementation whether it has an equivalent overwrite; if so, apply the same precedence fix there.

**Confidence/price active-comp fallback (in `step3-pricing-research.ts`)**

1. Today: `confidenceScore = calcConfidenceScore(filteredComps.length)` and `suggestedPriceCents` are both computed strictly from `filteredComps` (sold-only). When that's empty, both are the "zero data" state (20%, `null`) even if `lowestActive`/`relevantActive` (active comps, already computed a few lines earlier for the `lowestActive` field) has real matches.
2. New: when `filteredComps.length === 0` but `relevantActive.length > 0`, derive a real (lower-confidence, clearly labeled) estimate from the active-comp set — e.g. a fraction of `lowestActive`/median-of-active, with `confidenceScore` reflecting "active-market-only" rather than "zero data." `generatePricingMethodology`'s prompt gets a new branch/flag so the generated text says "based on N active listings, no confirmed sales" instead of "zero comparable sales, no sources" when this path is used.
3. `HB-0086` bug: root-cause why `lowestActive` came back `null` despite 38 active comps existing — likely something in `filterRelevantComps`'s batching (`COMP_FILTER_BATCH = 25`, HB-0086 has 38 candidates, crossing a batch boundary) or the LLM relevance call failing/timing out for that specific batch and the `catch` fail-open (`new Set(comps.map((_, i) => i))`) behaving unexpectedly. Reproduce against HB-0086 specifically during implementation.

**New comp sources**

- `fetchEbaySoldComps(query, serpApiKey)`: `GET https://serpapi.com/search?engine=ebay&_nkw=<query>&show_only=Sold&api_key=<key>`. Map `organic_results[]` → `{ source: 'ebay', title, sale_price_cents: price, sold_at: sold_date, listing_url }`. Wrap in a timeout (SerpAPI's eBay-sold path was observed taking >2min or `503`ing during investigation) and return `[]` on any failure — matches every other fetcher's resilience pattern in this file.
- TheRealReal: call `TheRealRealAdapter.searchSoldComps(query)` (or port its logic inline to match step3's existing fetcher shape) from the parallel `Promise.all` in `runStep3PricingResearch`. Classify results `therealreal_active` by default (not `therealreal`/sold) — see URL-verification below for reclassification.
- Both join the existing parallel fetch at `step3-pricing-research.ts:530-541`.

**Active-comp relevance filtering before insert**

- Today `toInsert = [...filteredComps, ...activeRows]` (`:665`) — `activeRows` (ebay_active, poshmark_active, mercari_active→removed, google_active, therealreal_active) are never passed through `filterRelevantComps`, only used transiently to compute `lowestActive`.
- New: run `activeRows` through the same relevance filter used for sold comps before insert, so `HB-0086`-style "38 active comps, mostly irrelevant Cambon-line variants" doesn't happen — only relevant active comps get written.

**URL-verification (comp identity + sold/active reclassification)**

- For each candidate comp (new fetcher output, before insert), fetch `listing_url`. Confirm the page content matches the claimed item (title/brand sanity check). For TheRealReal/Poshmark specifically, also check for a persisted "Sold" badge/state on the page:
  - If sold-badge confirmed → reclassify from `_active` to a real sold row (`source` without `_active` suffix, `sold_at` set from whatever date signal the page provides, or the scrape date as a lower-bound if no explicit date is shown).
  - If still live → stays `_active`.
- Best-effort: if fetching a given `listing_url` fails or times out, leave the comp in its default (active/unverified) classification rather than blocking the whole pipeline run on one slow page. Scope as sampled (e.g. top N candidates by relevance) if fetching every single comp proves too slow in practice — flag and adjust during implementation rather than over-commit here.

**Report-first regeneration**

1. Preview mode: run the (now-hardened) `runStep3PricingResearch` logic but collect the computed `toInsert` rows + derived price/confidence into a return value instead of writing to `pricing_comps`/`listings`. Render a markdown report per listing: thumbnail image (from the listing's primary photo), proposed comps (source, title, price, date if sold, `listing_url`), proposed `suggested_price_cents`/confidence/methodology.
2. Confirm mode: given a reviewed report (or listing id list), delete the listing's existing `pricing_comps` rows, then run the real insert + `pushPipelineStep` write — replace-on-regen, not additive.
3. Reuses/fixes the existing `retry-step.ts` degraded-context problem: preview/confirm mode need the same `notableFeatures`/color hints a fresh intake run has, not the empty-array reconstruction `retry-step.ts` does today.

**Credential health-check**

- eBay: reuse the `getEbayAppToken(EBAY_SCOPE_BASE)` mint-check pattern (already proven live during investigation) as a lightweight "is the app-level credential alive" probe.
- Poshmark: format-validate on save (`;`/`=` pairs present, not JWT-shaped) *and* a live probe (a small `fetchPoshmarkActiveFloor`-style call against a known-common query, checking for a non-error response) surfaced on the Settings → Platforms page.
- Mercari: no probe needed — the source is being dropped (see Explicitly Out of Scope).

---

## Error Handling

- Every new/modified fetcher (`fetchEbaySoldComps`, TheRealReal call, URL-verification fetches) follows the file's existing pattern: wrapped in try/catch, returns `[]`/`null` on any failure, never throws — a broken comp source must never block the pipeline (matches every existing fetcher in this file).
- The step4a precedence fix (`suggestedPriceCents ?? draft.suggested_price_cents`) has no new failure mode — it's a null-coalesce on data already being passed around.
- Report-first preview mode must not write to any table — a bug here would defeat the entire point of "report-first." Treat any write inside preview mode as a bug to catch in review, not just testing.
- Replace-on-regen's delete-then-insert is two statements, not a transaction (matches this codebase's existing best-effort style elsewhere) — if the insert fails after a successful delete, the listing temporarily has zero comps rather than stale ones. Acceptable given this only runs through the explicit confirm-mode path, not automatically.

---

## Testing

- Unit tests for the item+color filter extension (active comps now subject to `filterRelevantComps`), the step4a price-precedence fix (`suggestedPriceCents ?? draft.suggested_price_cents` — both branches), and the new active-comp confidence/price fallback logic in `step3-pricing-research.ts`.
- `fetchEbaySoldComps` and the TheRealReal fetcher: unit-testable in isolation (mock the HTTP layer) for response-mapping correctness; their *live* reliability (SerpAPI flakiness) is a manual/operational concern, not something a unit test can pin down — covered instead by the graceful-failure requirement above.
- No existing Supabase-mocking harness for API routes (`ai-listings-8du`, still open) — report-first preview/confirm endpoints get the same manual-verification treatment as the rest of this codebase's routes.
- Manual verification (see Verification below) is load-bearing here, more than usual, because several of these fixes were only discoverable by testing against real production data (HB-0084-87) in the first place.

---

## Verification

1. Re-run the hardened pipeline (report-first) against HB-0084/85/86/87: confirm `suggested_price_cents` traces to step3's comps-derived number wherever step3 found anything (not step4a's independent guess); HB-0085/86/87 no longer show "zero comparable sales" language when active comps exist; HB-0086 gets a non-blank `lowest_active_price_cents`; HB-0084 (genuinely zero comps even after adding TheRealReal/eBay-sold) still correctly falls back to speed-to-sell pricing, honestly labeled; no listing's methodology text mentions Mercari.
2. Confirm the new SerpAPI `engine=ebay` sold fetcher degrades gracefully when it hits the `503`/timeout behavior observed during investigation, and succeeds when SerpAPI's scrape does work.
3. Confirm at least one TheRealReal/Poshmark comp gets correctly reclassified from `_active` to a real sold comp (with date) after URL-verification confirms a "Sold" badge on the live page — and one that's still actually for sale stays `_active`.
4. Confirm the credential health-check correctly flags the *current* Poshmark cookie as invalid, and flags it as valid once Joe re-pastes a real cookie string (manual step: log into poshmark.com, DevTools → Network → any poshmark.com request → copy the full `Cookie:` header → paste into Settings → Platforms → Poshmark).
5. Run report-first (with thumbnails) over a handful of archived listings, including any pair Joe confirms are duplicate/parallel copies of the same item, and confirm the reports converge to consistent comps/pricing for both copies (or, if they don't, that's the exact inconsistency this tooling is meant to surface — write it up rather than silently reconcile).
6. `pnpm test` / `tsc --noEmit` clean on all touched files.
7. `ai-listings-9nh` stays closed with today's research recorded.

---

## Explicitly Out of Scope

- **Mercari as a comp source.** No real, stable public API exists for Mercari US search (confirmed via DNS + independent research: the live web app is gated behind a rotating Cloudflare bot-check cookie; every open-source Mercari-US project either fights that wall or pays for a scraping service). Dropping it is a deliberate cost/risk decision, not a placeholder — revisit only if the economics change (e.g. willing to pay for Apify/ScrapingBee).
- **eBay Marketplace Insights OAuth grant.** Confirmed structurally unavailable to this account type (`ai-listings-9nh`, closed). SerpAPI's `engine=ebay` sold-listings path is the accepted substitute, with known flakiness accepted as a tradeoff for not needing an approval process at all.
- **Mass regeneration of the archived catalog.** Joe will hand over a specific working set (the 4 live items + more). The archived catalog is used as a *test corpus* for hardening (task 10 above), not a backfill target, in this pass.
- **A full atomic transaction for replace-on-regen.** Matches existing codebase conventions (best-effort, not transactional) — see Error Handling.
- **Building out a general credential health-check framework beyond eBay + Poshmark.** Scoped to the two sources this investigation actually found broken; extend later if other sources rot the same way.
