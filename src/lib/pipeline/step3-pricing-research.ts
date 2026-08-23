import { runText } from '@/lib/claude'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { VisionAnalysis } from './step2-vision-analysis'
import type { ApiKeys } from '@/lib/user-api-keys'
import { searchEbayActive, type ActiveListing } from './comps/ebay-browse'
import { searchEbaySoldComps } from '@/lib/platforms/ebay-soldcomps'
import { conditionDelta, adjustForCondition, CATEGORY_DISCOUNT } from './pricing-adjust'
import { fetchSerpApi } from './serpapi-client'

interface SerpShoppingResult {
  title: string
  // Live-verified 2026-08-23: there's no plain `link` field on google_shopping results --
  // the URL field is `product_link` (a Google Shopping SERP link, not a direct retailer
  // URL). `link` was always undefined, which never surfaced because the extracted_price
  // bug above (fixed same day) meant every result was already filtered out before this
  // field was ever read.
  product_link: string
  source?: string
  condition?: string
  // Live-verified 2026-08-23: SerpAPI's google_shopping engine returns `price` as a
  // formatted string ("$266.25") with the numeric value in a separate top-level
  // `extracted_price` field -- NOT nested as `price.extracted_value`. That wrong shape
  // meant `result.price?.extracted_value` was undefined for every result, always,
  // silently dropping 100% of Google Shopping comps and retail-price detection.
  extracted_price?: number
}

interface SerpApiShoppingResponse {
  shopping_results?: SerpShoppingResult[]
  error?: string
}

async function fetchSerpComps(
  brand: string,
  model: string,
  apiKey: string
): Promise<SerpShoppingResult[]> {
  try {
    const query = `${brand} ${model}`
    const response = await fetchSerpApi((key) => {
      const url = new URL('https://serpapi.com/search')
      url.searchParams.set('engine', 'google_shopping')
      url.searchParams.set('q', query)
      url.searchParams.set('api_key', key)
      url.searchParams.set('num', '10')
      url.searchParams.set('condition', 'used')
      return url
    }, apiKey)

    if (!response || !response.ok) {
      console.warn(`fetchSerpComps: HTTP ${response?.status ?? '(no response)'} for query "${brand} ${model}"`)
      return []
    }

    const data = (await response.json()) as SerpApiShoppingResponse
    return data.shopping_results ?? []
  } catch (err) {
    // Every other fetcher in this file degrades to an empty/null result on failure
    // rather than throwing (this one didn't -- a SerpAPI 429 during a batch run
    // crashed runStep3PricingResearch entirely before any comps/pricing got written,
    // rather than just missing this one source, confirmed 2026-08-23 during a
    // 13-listing batch run: 5 listings failed outright on HTTP 429 alone).
    console.warn('fetchSerpComps: failed, returning empty', err instanceof Error ? err.message : String(err))
    return []
  }
}

interface RetailCandidate {
  title: string
  priceCents: number
  source: string
}

// Resale/consignment/auction marketplaces -- never a "retail" (MSRP) price even when Google
// Shopping tags the listing condition=new (sellers self-report condition; a used item resold
// "like new" on eBay is not a retail price). Live-confirmed 2026-08-23: the original "$81 at
// Vestiaire Collective" bug and a follow-up "$170 on eBay" both came from marketplace listings
// slipping past relevance scoring on brand+sub-type match alone. This is a source-type filter,
// not a relevance one -- a perfectly on-target eBay listing is still a resale price.
const RESALE_MARKETPLACE_SOURCES = [
  'ebay', 'vestiaire', 'stockx', 'poshmark', 'therealreal', 'the realreal', 'fashionphile',
  '1stdibs', 'rebag', 'grailed', 'depop', 'thredup', 'vinted', 'tradesy', 'mercari',
]
function isResaleMarketplace(source: string): boolean {
  const lower = source.toLowerCase()
  return RESALE_MARKETPLACE_SOURCES.some((s) => lower.includes(s))
}

// Returns raw candidates only -- no price is picked here. Live-tested 2026-08-23 against
// "Louis Vuitton Pocket Organizer (Monogram Taurillon Illusion)": a plain keyword search
// against Google Shopping returns 40 results spanning a dozen *different* LV products
// (Pocket Agenda Cover $81, Zippy Wallet, Onthego Organizer, Emily Notebook Cover...), not
// just the target item -- and their prices are all individually legitimate, so IQR/gap-ratio
// outlier detection can't tell the $81 agenda cover from a genuine cheap Pocket Organizer
// (q1=$520/q3=$1100 gives an IQR band down to -$350, well past $81). This is a relevance
// problem, not a statistical one -- the caller runs the same scoreCompRelevance gate already
// used for lowestActive before picking a price from these candidates.
async function fetchRetailCandidates(brand: string, model: string, apiKey: string): Promise<RetailCandidate[]> {
  try {
    const query = `${brand} ${model}`
    const response = await fetchSerpApi((key) => {
      const url = new URL('https://serpapi.com/search')
      url.searchParams.set('engine', 'google_shopping')
      url.searchParams.set('q', query)
      url.searchParams.set('api_key', key)
      url.searchParams.set('num', '10')
      url.searchParams.set('condition', 'new')
      return url
    }, apiKey)
    if (!response || !response.ok) {
      console.warn(`fetchRetailCandidates: HTTP ${response?.status ?? '(no response)'} for query "${query}"`)
      return []
    }

    const data = (await response.json()) as SerpApiShoppingResponse
    const results = data.shopping_results ?? []
    return results
      .filter((r): r is SerpShoppingResult & { extracted_price: number } =>
        typeof r.extracted_price === 'number' && r.extracted_price > 0 && !isResaleMarketplace(r.source ?? '')
      )
      .map((r) => ({ title: r.title, priceCents: Math.round(r.extracted_price * 100), source: r.source ?? 'Google Shopping' }))
  } catch (err) {
    console.warn('fetchRetailCandidates: failed, returning empty', err instanceof Error ? err.message : String(err))
    return []
  }
}

interface SerpApiEbayActiveResult {
  title?: string
  price?: { extracted?: number }
  link?: string
  condition?: string
}

interface SerpApiEbayActiveResponse {
  organic_results?: SerpApiEbayActiveResult[]
  error?: string
}

// SerpAPI's eBay engine, plain search (no show_only=Sold -- that filter is bot-blocked
// by eBay as of 2026-08, confirmed live: 90s timeout -> 503, isolated to the Sold filter
// specifically, while this plain-search form returned well under the 10s timeout below
// in initial testing). Used only as a fallback
// when the official Browse API (searchEbayActive) comes back empty -- see
// searchEbayActiveWithFallback below -- not called on the happy path, so a working
// Browse API never spends SerpAPI quota on a redundant second active-listings source.
async function fetchEbayActiveSerpApi(query: string, apiKey: string): Promise<ActiveListing[]> {
  if (!apiKey) return []
  try {
    const res = await fetchSerpApi((key) => {
      const url = new URL('https://serpapi.com/search')
      url.searchParams.set('engine', 'ebay')
      url.searchParams.set('_nkw', query)
      url.searchParams.set('api_key', key)
      return url
    }, apiKey, 10_000)
    if (!res || !res.ok) {
      console.warn(`fetchEbayActiveSerpApi: HTTP ${res?.status ?? '(no response)'} for query "${query}"`)
      return []
    }

    const data = (await res.json()) as SerpApiEbayActiveResponse
    if (data.error) {
      console.warn(`fetchEbayActiveSerpApi: SerpAPI error for query "${query}"`, JSON.stringify(data.error))
      return []
    }

    return (data.organic_results ?? [])
      .filter((r) => r.title && typeof r.price?.extracted === 'number' && r.price.extracted > 0 && r.link)
      .map((r) => ({
        title: r.title ?? '',
        priceCents: Math.round((r.price?.extracted ?? 0) * 100),
        url: r.link ?? '',
        condition: r.condition ?? 'Not specified',
        provider: 'serpapi' as const,
      }))
  } catch (err) {
    console.warn('fetchEbayActiveSerpApi: failed, returning empty', err instanceof Error ? err.message : String(err))
    return []
  }
}

// Browse API (official, structured, free) is the primary active-listings source.
// SerpAPI's scrape only runs when Browse comes back empty -- token/quota issues, not
// the common case -- so a healthy Browse API never costs a SerpAPI request.
async function searchEbayActiveWithFallback(query: string, serpApiKey: string): Promise<ActiveListing[]> {
  const browseResults = await searchEbayActive(query)
  if (browseResults.length > 0) return browseResults
  return fetchEbayActiveSerpApi(query, serpApiKey)
}

interface SerpApiOrganicResult {
  title?: string
  snippet?: string
  link?: string
}

interface SerpApiGoogleResponse {
  organic_results?: SerpApiOrganicResult[]
}

// Google Shopping / site-search snippets for resale platforms frequently show
// both the original retail price and the resale price in the same snippet
// (e.g. "Originally $1,200 · Now $380"). Taking the *last* dollar amount was the
// existing approach here, on the assumption the retail figure always comes first --
// but that ordering isn't reliable across sources: a TheRealReal snippet surfaced
// "estimated retail price" as the trailing figure, so the last-match heuristic
// picked the $1,200 reference price over the item's actual $369 listed price
// (ai-listings dashboard report, HB-0102, 2026-08-21). Explicitly excluding
// reference-price language near each match, regardless of position, is robust to
// either ordering.
const RETAIL_REFERENCE_PATTERN = /\b(?:est(?:imated)?\.?\s*retail|orig(?:inal)?(?:ly)?\.?\s*retail|retail\s*price|msrp|compare\s*at)\b/i

export function extractPriceFromSnippet(snippet: string): number | null {
  const matches = [...snippet.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)]
  const realMatches = matches.filter((m, i) => {
    // Bounded by the end of the previous match, not just a flat 40-char lookback -- a
    // reference-price label attached to an earlier amount (e.g. "MSRP $1,200, our price
    // $369") sits within 40 chars of the later, unrelated $369 and would otherwise wrongly
    // exclude it too.
    const prevEnd = i > 0 ? (matches[i - 1].index ?? 0) + matches[i - 1][0].length : 0
    const start = Math.max(prevEnd, Math.max(0, (m.index ?? 0) - 40))
    return !RETAIL_REFERENCE_PATTERN.test(snippet.slice(start, m.index ?? 0))
  })
  if (realMatches.length === 0) return null
  const last = realMatches[realMatches.length - 1]
  const dollars = parseFloat(last[1].replace(/,/g, ''))
  return isNaN(dollars) ? null : Math.round(dollars * 100)
}

// site:therealreal.com search via SerpAPI's generic Google engine. TheRealReal has
// no public API; TheRealRealAdapter.searchSoldComps() (src/lib/platforms/adapters/
// therealreal.ts) already implements this exact approach but takes a userId the
// pricing pipeline doesn't have and never actually uses it (only reads
// process.env.SERPAPI_API_KEY) -- reimplemented standalone here to match this
// file's existing fetcher(query, apiKey) shape instead of instantiating that class.
// Search-result snippets can't distinguish "for sale" from "sold" -- every result
// here is classified therealreal_active by default. url-verify.ts implements a
// best-effort URL-verification reclassification pass, but wiring it in here is
// deliberately deferred (tracked: ai-listings-534) -- comps here stay classified
// as active until that lands.
async function fetchTheRealRealComps(
  query: string,
  apiKey: string
): Promise<Array<{ title: string; priceCents: number; listingUrl: string }>> {
  if (!apiKey) return []
  try {
    const res = await fetchSerpApi((key) => {
      const url = new URL('https://serpapi.com/search')
      url.searchParams.set('engine', 'google')
      url.searchParams.set('q', `site:therealreal.com ${query}`)
      url.searchParams.set('num', '10')
      url.searchParams.set('api_key', key)
      return url
    }, apiKey, 15_000)
    if (!res || !res.ok) {
      console.warn(`fetchTheRealRealComps: HTTP ${res?.status ?? '(no response)'} for query "${query}"`)
      return []
    }

    const data = (await res.json()) as SerpApiGoogleResponse
    return (data.organic_results ?? [])
      .map((r) => {
        const priceCents = r.snippet ? extractPriceFromSnippet(r.snippet) : null
        if (!priceCents) return null
        return { title: r.title ?? '', priceCents, listingUrl: r.link ?? '' }
      })
      .filter((c): c is { title: string; priceCents: number; listingUrl: string } => c !== null)
  } catch (err) {
    console.warn(`fetchTheRealRealComps: failed for query "${query}"`, err instanceof Error ? err.message : String(err))
    return []
  }
}

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
  const suggestedStr = suggestedPriceCents != null ? `$${(suggestedPriceCents / 100).toFixed(2)}` : 'N/A'
  const priceToMoveStr = priceToMoveCents != null ? `$${(priceToMoveCents / 100).toFixed(2)}` : 'N/A'
  const retailStr = retailPriceCents != null ? ` Retail new: $${(retailPriceCents / 100).toFixed(2)}.` : ''
  const sourcesStr = [...new Set(sources)].join(', ')

  let historyStr = ''
  if (priceHistory.length > 1) {
    const oldest = priceHistory[0]
    const daysSinceListed = Math.round(
      (Date.now() - new Date(oldest.created_at).getTime()) / (1000 * 60 * 60 * 24)
    )
    const priceList = priceHistory
      .map((e) => {
        const date = new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return `$${(e.price_cents / 100).toFixed(2)} on ${date}`
      })
      .join(', ')
    historyStr = ` Price history shows ${priceHistory.length} previous prices: ${priceList}. The listing has been on market for ${daysSinceListed} days.`
  }

  const dataBasisNote = isActiveOnly
    ? ' IMPORTANT: these are CURRENT ASKING PRICES from active listings, not confirmed sales -- say so explicitly (e.g. "based on N active listings, no confirmed sold comps"), do not describe this as a "market median" or imply any sale has actually occurred at this price.'
    : ''
  const prompt = `In 80–100 words, explain how this resale price was determined. Comp count: ${compCount}. Sources: ${sourcesStr}. Median adjusted price: ${suggestedStr}. Confidence: ${confidenceScore}%. Speed-to-sell price: ${priceToMoveStr} (${Math.round(discountPct * 100)}% below market median, typically sells in days vs weeks at list price).${retailStr}${historyStr}${dataBasisNote} Return only the paragraph, no headings.`

  const text = await runText({
    model: 'claude-haiku-4-5',
    maxTokens: 200,
    prompt,
    apiKey: apiKeys.anthropic,
  })

  return text.trim()
}

interface RedditPost {
  title: string
  selftext: string
  url: string
  created_utc: number
}

interface RedditExtracted {
  title: string
  price_cents: number
}

async function fetchRedditMechmarketComps(
  brand: string,
  model: string,
  anthropicApiKey: string
): Promise<Array<{
  source: string
  title: string
  sale_price_cents: number
  sold_at: string | null
  listing_url: string
}>> {
  try {
    const searchQuery = `[H] ${brand} ${model}`
    const params = new URLSearchParams({
      q: searchQuery,
      sort: 'new',
      limit: '25',
      restrict_sr: '1',
      type: 'link',
    })
    const res = await fetch(
      `https://www.reddit.com/r/mechmarket/search.json?${params.toString()}`,
      { headers: { 'User-Agent': 'ai-listings/1.0' } }
    )
    if (!res.ok) return []

    const data = (await res.json()) as { data: { children: Array<{ data: RedditPost }> } }
    const posts = (data?.data?.children ?? []).map((c) => c.data)

    if (posts.length === 0) return []

    const top = posts.slice(0, 15)
    const postsText = top
      .map(
        (p, i) =>
          `--- Post ${i + 1} ---\nTitle: ${p.title}\nBody: ${p.selftext?.slice(0, 500) ?? '(no body)'}\nURL: ${p.url}`
      )
      .join('\n\n')

    const text = await runText({
      model: 'claude-haiku-4-5',
      maxTokens: 1024,
      apiKey: anthropicApiKey,
      prompt: `Extract selling prices for ${brand} ${model} from these mechmarket posts. Return a JSON array only (no prose, no markdown fences): [{ "title": string, "price_cents": number }]. Only include posts that appear to be actual sale listings with a clear price. If no qualifying posts exist, return [].

${postsText}`,
    })

    let extracted: RedditExtracted[] = []
    try {
      const json = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      extracted = JSON.parse(json)
      if (!Array.isArray(extracted)) return []
    } catch {
      return []
    }

    const postsByTitle = Object.fromEntries(top.map((p) => [p.title, p]))

    return extracted
      .filter((e) => typeof e.price_cents === 'number' && e.price_cents > 0 && e.price_cents < 10_000_000)
      .map((e) => {
        const matchedPost = postsByTitle[e.title]
        return {
          source: 'reddit',
          title: e.title,
          sale_price_cents: Math.round(e.price_cents),
          sold_at: matchedPost ? new Date(matchedPost.created_utc * 1000).toISOString() : null,
          listing_url: matchedPost?.url ?? `https://www.reddit.com/r/mechmarket/search/?q=${encodeURIComponent(brand + ' ' + model)}`,
        }
      })
  } catch {
    return []
  }
}

async function fetchPoshmarkSoldComps(
  query: string,
  cookies: string
): Promise<Array<{ title: string; priceCents: number; soldAt: string | null; listingUrl: string }>> {
  if (!cookies) return []
  try {
    const params = new URLSearchParams({
      app_version: '2.55',
      count: '30',
      max_id: '0',
      q: query,
      sort_by: 'best_match',
      availability: 'sold_out',
      summarize: 'true',
      _: Date.now().toString(),
    })
    const res = await fetch(`https://poshmark.com/vm-rest/posts?${params}`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<{ id: string; title?: string; price?: string; updated_at?: string }> }
    return (data.data ?? [])
      .filter((item) => item.title && item.price)
      .map((item) => {
        const match = (item.price ?? '').match(/[\d.]+/)
        const priceCents = match ? Math.round(parseFloat(match[0]) * 100) : 0
        return { title: item.title ?? '', priceCents, soldAt: item.updated_at ?? null, listingUrl: `https://poshmark.com/listing/${item.id}` }
      })
      .filter((item) => item.priceCents > 0)
  } catch {
    return []
  }
}

async function fetchPoshmarkActiveFloor(
  query: string,
  cookies: string
): Promise<Array<{ title: string; priceCents: number; listingUrl: string }>> {
  if (!cookies) return []
  try {
    const params = new URLSearchParams({
      app_version: '2.55',
      count: '10',
      max_id: '0',
      q: query,
      sort_by: 'price_asc',
      availability: 'available',
      summarize: 'true',
      _: Date.now().toString(),
    })
    const res = await fetch(`https://poshmark.com/vm-rest/posts?${params}`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<{ id: string; title?: string; price?: string }> }
    return (data.data ?? [])
      .filter((item) => item.title && item.price)
      .map((item) => {
        const match = (item.price ?? '').match(/[\d.]+/)
        const priceCents = match ? Math.round(parseFloat(match[0]) * 100) : 0
        return { title: item.title ?? '', priceCents, listingUrl: `https://poshmark.com/listing/${item.id}` }
      })
      .filter((item) => item.priceCents > 0)
  } catch {
    return []
  }
}

function deduplicateComps<T extends { adjusted_price_cents: number; title: string }>(comps: T[]): T[] {
  // Remove bulk-lot duplicates: same seller listing same item 10+ times at identical price
  const kept: T[] = []
  const priceBucketCount = new Map<number, number>()
  for (const c of comps) {
    const bucket = Math.round(c.adjusted_price_cents / 100) // bucket by dollar
    const count = priceBucketCount.get(bucket) ?? 0
    if (count < 2) {
      kept.push(c)
      priceBucketCount.set(bucket, count + 1)
    }
  }
  return kept
}

function removeOutlierComps<T extends { adjusted_price_cents: number }>(comps: T[]): T[] {
  if (comps.length < 4) return comps
  const sorted = [...comps].sort((a, b) => a.adjusted_price_cents - b.adjusted_price_cents)
  const prices = sorted.map((c) => c.adjusted_price_cents)

  // Detect bimodal distribution: find the largest relative gap between consecutive prices
  let maxGapIdx = 0
  let maxGapRatio = 0
  for (let i = 1; i < prices.length; i++) {
    const ratio = prices[i] / prices[i - 1]
    if (ratio > maxGapRatio) { maxGapRatio = ratio; maxGapIdx = i }
  }

  // If the gap is > 4× (e.g. $375 → $3,750), use only the lower cluster (single items vs. bulk lots)
  if (maxGapRatio > 4 && maxGapIdx >= 2) {
    return sorted.slice(0, maxGapIdx)
  }

  // Otherwise fall back to IQR
  const q1 = prices[Math.floor(prices.length * 0.25)]
  const q3 = prices[Math.floor(prices.length * 0.75)]
  const iqr = q3 - q1
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  return comps.filter((c) => c.adjusted_price_cents >= lo && c.adjusted_price_cents <= hi)
}

// Single source of truth for the sold/active split convention used both at
// insert time (compRows/activeRows) and on reload (effectiveSoldComps/
// effectiveActiveComps) -- previously each call site re-derived this inline,
// so a future source name that doesn't follow the "_active" suffix (or a typo
// in one of the call sites) could silently split rows the wrong way.
function isActiveSource(source: string): boolean {
  return source.endsWith('_active')
}

function calcConfidenceScore(compCount: number): number {
  if (compCount >= 10) return 90
  if (compCount >= 6) return 75
  if (compCount >= 3) return 60
  if (compCount >= 1) return 40
  return 20
}

const COMP_RELEVANCE_THRESHOLD = 6
const COMP_FILTER_BATCH = 25

export interface CompRelevance {
  /** null means "not actually scored" — either an explicit failed-batch result
   * from scoreCompRelevance, or simply never attempted (e.g. no Anthropic key
   * configured, so the map has no entry for this index at all and a caller's
   * `?? null` fallback applies). Both collapse to the same null on the row;
   * distinct from a real 0-10 judgment and never persisted as if it were one —
   * callers decide fail-open vs fail-closed per use case. */
  score: number | null
  color: string | null
}

/** Scans forward from `fromIndex` for the next balanced top-level `{...}`
 * object by brace-depth counting, rather than regex — a regex either
 * truncates on the first nested `}` (non-greedy) or overshoots past trailing
 * prose into a later unrelated `}` (greedy), and this response nests a
 * `{score, color}` object per index. Tracks double-quoted JSON string
 * literals (respecting `\"` escapes) so a `{`/`}` inside a quoted color value
 * (e.g. `"vintage {frame}"`) doesn't perturb the depth count. Returns null
 * once no further `{` exists — callers advance `fromIndex` past a candidate
 * that failed to parse to try the next one, rather than giving up on the
 * first brace pair, which may be prose the model wrote before the payload. */
function findNextJsonObject(text: string, fromIndex: number): { text: string; endIndex: number } | null {
  const start = text.indexOf('{', fromIndex)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { text: text.slice(start, i + 1), endIndex: i + 1 }
    }
  }
  return null
}

/** Parses the LLM's per-index `{score, color}` scoring response into a map of
 * every entry it could recover. Scans candidate balanced-brace objects in
 * order and uses the first one that parses as JSON — so prose containing
 * braces before the real payload (e.g. `Note {approximate}. {"0":...}`) is
 * skipped rather than causing the whole batch to come back empty. A missing
 * object, malformed JSON in every candidate, a non-integer or negative index,
 * and a score that's non-numeric or outside 0-10 all degrade to that entry
 * being dropped rather than thrown — callers apply their own relevance
 * threshold against the returned scores. */
export function parseRelevanceScores(text: string): Map<number, CompRelevance> {
  const entries = new Map<number, CompRelevance>()
  let searchFrom = 0
  let sawCandidate = false
  while (true) {
    const found = findNextJsonObject(text, searchFrom)
    if (!found) break
    sawCandidate = true
    searchFrom = found.endIndex
    let parsed: Record<string, { score?: unknown; color?: unknown }>
    try {
      parsed = JSON.parse(found.text) as Record<string, { score?: unknown; color?: unknown }>
    } catch {
      continue // not valid JSON — likely prose containing a brace pair; try the next candidate
    }
    for (const [idx, entry] of Object.entries(parsed)) {
      const numericIdx = Number(idx)
      if (!Number.isInteger(numericIdx) || numericIdx < 0) continue
      const score = entry?.score
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10) continue
      const color = typeof entry?.color === 'string' ? entry.color : null
      entries.set(numericIdx, { score, color })
    }
    if (entries.size === 0 && Object.keys(parsed).length > 0) {
      console.error(`[step3] parseRelevanceScores: JSON parsed but yielded no valid entries: ${found.text.slice(0, 200)}`)
    }
    break // used the first candidate that parsed as valid JSON, regardless of entry count
  }
  if (!sawCandidate) {
    console.error(`[step3] parseRelevanceScores: no balanced JSON object found in LLM response: ${text.slice(0, 200)}`)
  }
  return entries
}

/** Scores every comp 0-10 against the target item and extracts each title's own
 * color/variant descriptor. Returns relevance data for ALL input comps (not just
 * ones above threshold) — callers decide what counts as relevant for their use
 * case (e.g. active comps are inserted regardless of score, but still tagged).
 * Each batch's LLM call is isolated: one batch failing doesn't discard scores
 * already recovered from other batches, and a failed batch's comps get an
 * explicit null score (never a fabricated passing score) so callers can choose
 * fail-open or fail-closed honestly instead of silently trusting fake data. */
async function scoreCompRelevance(
  comps: Array<{ title: string }>,
  brand: string,
  model: string,
  category: string,
  notableFeatures: string[],
  anthropicApiKey: string
): Promise<Map<number, CompRelevance>> {
  if (comps.length === 0) return new Map()
  const scored = new Map<number, CompRelevance>()
  const featureHints = notableFeatures.slice(0, 4).join(', ')
  const targetDesc = featureHints
    ? `"${brand} ${model}" (${category}) — key attributes: ${featureHints}`
    : `"${brand} ${model}" (${category})`
  for (let start = 0; start < comps.length; start += COMP_FILTER_BATCH) {
    const batch = comps.slice(start, start + COMP_FILTER_BATCH)
    const titlesBlock = batch.map((c, i) => `${start + i}. ${c.title}`).join('\n')
    try {
      const text = await runText({
        model: 'claude-haiku-4-5',
        maxTokens: 768,
        apiKey: anthropicApiKey,
        prompt: `Score each title by how well it matches this specific item: ${targetDesc}.

Scale 0–10:
10 = exact match (brand, model, AND key attributes like color/material/sub-type all match)
7–9 = same brand, model, and sub-type; minor variant (slightly different colorway or size)
4–6 = same brand and sub-type but wrong color, pattern, or model variant
0–3 = wrong sub-type, wrong brand, or unrelated item

Rules:
- Sub-type MUST match to score above 3. A card holder is not a wallet. A bifold wallet is not a zip-around. A pendant necklace is not a bracelet. A backpack is not a tote. Wrong sub-type = 0–3.
- Product generation/version MUST match to score above 3. MK3 ≠ MK2 ≠ MK1. Gen 2 ≠ Gen 1. v3 ≠ v2. iPhone 14 ≠ iPhone 13. Wrong generation = 0–3.
- Color/material MUST match to score above 6. If the target has a specific colorway or pattern (e.g. "graffiti", "sterling silver", "white lambskin", "tie-dye") and the comp mentions a different one, cap at 5.
- Bulk lots (e.g. "lot of 10", clearly re-seller inventory) = 0.

Also extract each title's own color/material/variant descriptor as a short phrase (e.g. "black leather", "sterling silver", "graffiti print") — null if the title doesn't mention one.

Return ONLY a JSON object mapping index → {"score": number, "color": string|null}. Example: {"0":{"score":8,"color":"black leather"},"1":{"score":2,"color":"tan canvas"}}

Titles:
${titlesBlock}`,
      })
      for (const [idx, relevance] of parseRelevanceScores(text)) {
        scored.set(idx, relevance)
      }
    } catch (err) {
      console.error(`[step3] scoreCompRelevance: batch at offset ${start} (${batch.length} comps) failed, marking unscored`, err)
      for (let i = 0; i < batch.length; i++) {
        scored.set(start + i, { score: null, color: null })
      }
    }
  }
  return scored
}

export async function runStep3PricingResearch(
  listingId: string,
  step2: VisionAnalysis,
  model: string,
  apiKeys: ApiKeys,
  gender?: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const isKeyboard = step2.category?.toLowerCase() === 'keyboards'

  const genderPrefix = gender === 'mens' ? "men's " : gender === 'womens' ? "women's " : ''
  const searchQuery = `${genderPrefix}${step2.brand} ${model}`
  const [ebayActive, serpResults, redditComps, retailCandidates, poshmarkSold, poshmarkActive, ebaySold, theRealRealComps] = await Promise.all([
    searchEbayActiveWithFallback(searchQuery, apiKeys.serpapi),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailCandidates(step2.brand, model, apiKeys.serpapi),
    fetchPoshmarkSoldComps(searchQuery, apiKeys.poshmarkCookies),
    fetchPoshmarkActiveFloor(searchQuery, apiKeys.poshmarkCookies),
    searchEbaySoldComps(searchQuery, apiKeys.soldcomps),
    fetchTheRealRealComps(searchQuery, apiKeys.serpapi),
  ])

  const compRows: Array<{
    listing_id: string
    source: string
    title: string
    sale_price_cents: number
    condition: string
    sold_at: string | null
    listing_url: string
    condition_delta: 'same' | 'better' | 'worse'
    adjusted_price_cents: number
    relevance_score: number | null
    color: string | null
    provider: string | null
  }> = []

  for (const result of serpResults) {
    if (!result.extracted_price) continue
    const priceCents = Math.round(result.extracted_price * 100)
    const source = result.source?.toLowerCase().includes('poshmark')
      ? 'poshmark_active'
      : result.source?.toLowerCase().includes('therealreal')
        ? 'therealreal_active'
        : 'google_active'
    const delta = conditionDelta(step2.condition, result.condition ?? 'unknown')
    compRows.push({
      listing_id: listingId,
      source,
      title: result.title,
      sale_price_cents: priceCents,
      condition: result.condition ?? 'Not specified',
      sold_at: null,
      listing_url: result.product_link,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(priceCents, delta),
      relevance_score: null,
      color: null,
      provider: 'serpapi',
    })
  }

  for (const comp of redditComps) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId,
      source: comp.source,
      title: comp.title,
      sale_price_cents: comp.sale_price_cents,
      condition: 'Not specified',
      sold_at: comp.sold_at,
      listing_url: comp.listing_url,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(comp.sale_price_cents, delta),
      relevance_score: null,
      color: null,
      provider: 'reddit_claude',
    })
  }

  for (const item of poshmarkSold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'poshmark', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
      relevance_score: null, color: null, provider: 'poshmark_direct',
    })
  }

  for (const item of ebaySold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'ebay', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
      relevance_score: null, color: null, provider: 'soldcomps',
    })
  }

  // Active market comps — context only, excluded from sold-price median
  const activeRows: typeof compRows = []
  for (const item of ebayActive) {
    activeRows.push({
      listing_id: listingId, source: 'ebay_active', title: item.title,
      sale_price_cents: item.priceCents, condition: item.condition, sold_at: null,
      listing_url: item.url, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null, provider: item.provider,
    })
  }
  for (const item of poshmarkActive) {
    activeRows.push({
      listing_id: listingId, source: 'poshmark_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null, provider: 'poshmark_direct',
    })
  }
  for (const item of theRealRealComps) {
    activeRows.push({
      listing_id: listingId, source: 'therealreal_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null, provider: 'serpapi',
    })
  }
  // Move any _active rows that ended up in compRows (from SerpAPI) into activeRows
  const soldRows = compRows.filter((r) => !isActiveSource(r.source))
  activeRows.push(...compRows.filter((r) => isActiveSource(r.source)))

  // Lowest live exact-item listing — surfaced as a fast-sale data point (never auto-prices).
  // Filter to the SAME exact item+color first: a raw keyword search surfaces unrelated
  // cheap items (a $9.99 Kenneth Cole is not a Movado comp), which would wreck the signal.
  // Without the relevance gate we can't trust the cheapest active listing (it could be
  // an unrelated $9.99 item), so surface nothing rather than a wrong signal.
  const activeRelevance = apiKeys.anthropic && activeRows.length > 0
    ? await scoreCompRelevance(activeRows, step2.brand, model, step2.category, step2.notableFeatures, apiKeys.anthropic)
    : new Map<number, CompRelevance>()
  // Every active row gets inserted regardless of relevance (it's context-only, never
  // auto-prices) — but still tag each with whatever score/color was found, for later
  // auditability of why a given active comp shows up.
  activeRows.forEach((row, i) => {
    const relevance = activeRelevance.get(i)
    row.relevance_score = relevance?.score ?? null
    row.color = relevance?.color ?? null
  })
  // No key, no scoring attempt, or a failed batch all leave relevance_score null — for
  // lowestActive specifically that must stay fail-CLOSED (null never counts as passing):
  // an unverified "cheapest active listing" is worse than surfacing none, per the comment above.
  const relevantActive = activeRows.filter(
    (row) => row.relevance_score !== null && row.relevance_score >= COMP_RELEVANCE_THRESHOLD
  )
  const lowestActive = relevantActive.length > 0
    ? relevantActive.reduce((min, r) => (r.sale_price_cents < min.sale_price_cents ? r : min))
    : null

  // Retail "new" price -- same fail-closed relevance gate as lowestActive above: a raw
  // keyword search over Google Shopping mixes in different same-brand products (see
  // fetchRetailCandidates' comment), so the unfiltered minimum is untrustworthy. A wrong
  // "$81 retail" claim shown on the listing is worse than showing none, so no key / no
  // score / a failed scoring batch all mean no retail price this run, not a guess.
  const retailRelevance = apiKeys.anthropic && retailCandidates.length > 0
    ? await scoreCompRelevance(retailCandidates, step2.brand, model, step2.category, step2.notableFeatures, apiKeys.anthropic)
    : new Map<number, CompRelevance>()
  // Luxury houses (LV, Chanel, Hermes, etc.) distribute exclusively through their own
  // boutiques/site -- there is no legitimate third-party "retail" channel for them, so any
  // source not carrying the brand's own name is a resale/consignment listing regardless of
  // what it calls itself. Live-confirmed 2026-08-23: "Lulu Cadieux" (a consignment boutique,
  // not on the marketplace denylist) passed the relevance gate on a WRONG colorway ("Shadow
  // Black" vs. the target "Illusion") and still would've been trusted as retail without this.
  const relevantRetail = retailCandidates
    .map((c, i) => ({ ...c, adjusted_price_cents: c.priceCents, relevance_score: retailRelevance.get(i)?.score ?? null }))
    .filter((c) => c.relevance_score !== null && c.relevance_score >= COMP_RELEVANCE_THRESHOLD)
    .filter((c) => !step2.isLuxury || c.source.toLowerCase().includes(step2.brand.toLowerCase()))
  const filteredRetail = removeOutlierComps(relevantRetail)
  let retailResult: { retailPriceCents: number; source: string; promoNote: string | null } | null = null
  if (filteredRetail.length > 0) {
    const sortedRetail = [...filteredRetail].sort((a, b) => a.priceCents - b.priceCents)
    const lowestRetail = sortedRetail[0]
    let promoNote: string | null = null
    if (sortedRetail.length >= 2) {
      const prices = sortedRetail.map((r) => r.priceCents)
      const median =
        prices.length % 2 === 0
          ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          : prices[Math.floor(prices.length / 2)]
      if (lowestRetail.priceCents < median * 0.85) {
        promoNote = 'Appears to be on sale'
      }
    }
    retailResult = { retailPriceCents: lowestRetail.priceCents, source: lowestRetail.source, promoNote }
  }

  // Deduplicate same-price clusters before relevance filtering (catches bulk-lot duplicate listings)
  const dedupedRows = deduplicateComps(soldRows)

  // Filter out irrelevant comps (wrong product type, wrong color/variant, unrelated merchandise)
  const soldRelevance = apiKeys.anthropic
    ? await scoreCompRelevance(dedupedRows, step2.brand, model, step2.category, step2.notableFeatures, apiKeys.anthropic)
    : null
  // Sold comps feed the pricing median directly, so — unlike lowestActive above — a null
  // relevance_score (no key, or a failed scoring batch) stays fail-OPEN: keep the comp rather
  // than risk starving the median of evidence over a transient scoring failure.
  const relevantComps = dedupedRows
    .map((row, i) => {
      const relevance = soldRelevance?.get(i)
      return { ...row, relevance_score: relevance?.score ?? null, color: relevance?.color ?? null }
    })
    .filter((row) => row.relevance_score === null || row.relevance_score >= COMP_RELEVANCE_THRESHOLD)

  // Remove bimodal outliers / IQR outliers to cut bulk lots and anomalous prices
  const filteredComps = removeOutlierComps(relevantComps)

  // Same dedupe + outlier removal the sold-comp path gets above (dedupedRows ->
  // filteredComps), applied here to relevantActive (the relevance-filtered active
  // set) to produce filteredActive. Without this, an active-comp fallback median
  // (below) or the persisted rows can be dominated by duplicate/cross-posted
  // listings or repeated same-price inventory -- the exact failure mode
  // deduplicateComps/removeOutlierComps exist to catch, just not previously
  // applied on the active side.
  const filteredActive = removeOutlierComps(deduplicateComps(relevantActive))
  if (relevantActive.length > 0 && filteredActive.length === 0) {
    console.warn(
      `step3: filteredActive dropped all ${relevantActive.length} relevant active comps (dedup/outlier removal) for listing ${listingId}`
    )
  }

  // Insert all: filtered sold comps + relevance-filtered, deduped, outlier-filtered
  // active market context. activeRows itself stays unfiltered (used above for the
  // lowestActive/relevantActive fallback signal), but only the fully-filtered subset
  // gets written -- HB-0086 had 38 unfiltered active comps, most of them
  // loosely-related Chanel Cambon variants, none checked against item+color before
  // this fix.
  //
  // step3 can be retried (see retry-step.ts), and computeAdjustedPricing (pricing-adjust.ts)
  // treats every stored pricing_comps row for the listing as current, sold-comp evidence -- a
  // retry that only inserted its fresh results would blend stale and current comps into the
  // median. Replace the prior run's rows, but insert-then-delete (not delete-then-insert): if
  // the insert below fails, the earlier delete would otherwise leave the listing with zero
  // comps even though the prior run's evidence was still valid.
  //
  // The delete excludes by the newly inserted rows' own ids, not a timestamp cutoff -- a
  // client-clock timestamp compared against pricing_comps.created_at (the database's own clock)
  // is vulnerable to ordinary clock skew between the app node and Postgres, which could delete
  // the batch just inserted above and leave the listing with zero comps.
  //
  // Both the insert AND the subsequent delete-old-rows step are gated on toInsert.length > 0.
  // Most fetchers in this file degrade to an empty array on failure (expired cookies, API
  // quota, flaky upstream) rather than throwing; if every source fails on one re-run, toInsert
  // is empty, and deleting anyway would silently wipe a prior run's real comps with no error
  // signal and no replacement data -- ai-listings-drz confirmed this exact scenario (a step3
  // retry that found zero comps cleared suggested_price_cents, leaving the listing with no
  // price at all). Skip both operations together in that case, leaving existing data untouched.
  const toInsert = [...filteredComps, ...filteredActive]
  const insertedIds: string[] = []
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase.from('pricing_comps').insert(toInsert).select('id')
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
    insertedIds.push(...(inserted ?? []).map((row) => row.id as string))

    // Only now that the fresh comps are safely stored, clear anything from a prior run.
    // Guarded on insertedIds.length: an insert that succeeds (no `error`) but whose
    // `.select('id')` comes back empty -- e.g. an RLS SELECT policy that doesn't cover
    // the just-inserted rows -- would otherwise build `.not('id','in','()')`, which is
    // invalid Postgres syntax. Skipping the delete in that case is also the safer
    // choice on its own merits: leave the prior run's comps in place rather than
    // execute a filter we can't build correctly.
    if (insertedIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('pricing_comps')
        .delete()
        .eq('listing_id', listingId)
        .not('id', 'in', `(${insertedIds.join(',')})`)
        // Hand-entered comps (POST /api/listings/[id]/comps) aren't something this run
        // fetched and can't regenerate -- an automated retry must never delete data the
        // seller typed in themselves, even though it deletes every other prior-run row.
        .not('source', 'in', '(manual,manual_active)')
      if (deleteError) {
        throw new Error(`step3: pricing_comps delete failed — ${deleteError.message}`)
      }
    } else {
      console.warn(
        `step3: pricing_comps insert succeeded but returned no ids for listing ${listingId} — skipped delete-old-rows, prior comps preserved`
      )
    }
  }

  // toInsert.length === 0 means every fetcher came back empty this run and the
  // insert/delete above was skipped entirely -- pricing_comps was left untouched
  // on purpose. But everything below this point recomputes confidence/price from
  // filteredComps/filteredActive, which are ALSO empty in that case: falling
  // through unguarded would still overwrite the listing's suggested_price_cents
  // with null and confidence with 20% via pushPipelineStep below, even though the
  // real comp evidence is sitting untouched in the table -- exactly the
  // ai-listings-drz scenario referenced above, just one layer up (the listing's
  // pricing fields instead of the pricing_comps rows). Reload what's actually
  // persisted and compute against that instead of an empty result set.
  let effectiveSoldComps = filteredComps
  let effectiveActiveComps = filteredActive
  if (toInsert.length === 0) {
    const { data: existingRows, error: reloadError } = await supabase
      .from('pricing_comps')
      .select('*')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (reloadError) {
      // Same reasoning as the insert/delete guards above: a failed read here must
      // not fall through and silently overwrite the listing's pricing fields with
      // null/20%-confidence via pushPipelineStep below, as if there were genuinely
      // zero comps -- throw so the caller's retry logic gets a chance to succeed
      // against a transient failure instead.
      throw new Error(`step3: pricing_comps reload failed — ${reloadError.message}`)
    }
    // These rows were persisted by a prior run's own filteredComps/filteredActive
    // (already deduped + outlier-removed at insert time -- see toInsert above), but
    // re-run the same passes here rather than trusting that invariant blindly: rows
    // from an older pipeline version, or a mix of two different runs' comps sitting
    // in the table together, could reintroduce duplicates/outliers that a fresh run
    // would have caught.
    const existing = (existingRows ?? []) as typeof compRows
    effectiveSoldComps = removeOutlierComps(deduplicateComps(existing.filter((r) => !isActiveSource(r.source))))
    effectiveActiveComps = removeOutlierComps(deduplicateComps(existing.filter((r) => isActiveSource(r.source))))
  } else {
    // toInsert.length > 0 means this run's own fresh fetch produced filteredComps/
    // filteredActive above -- but those come purely from THIS run's external calls and
    // never touch the DB, so a hand-entered comp (preserved by the delete-old-rows guard's
    // manual/manual_active exclusion) would otherwise sit in pricing_comps completely
    // unused by every subsequent automated run. Fold it back in here.
    const { data: manualRows } = await supabase
      .from('pricing_comps')
      .select('*')
      .eq('listing_id', listingId)
      .in('source', ['manual', 'manual_active'])
    if (manualRows && manualRows.length > 0) {
      const manual = manualRows as typeof compRows
      effectiveSoldComps = removeOutlierComps(
        deduplicateComps([...effectiveSoldComps, ...manual.filter((r) => r.source === 'manual')])
      )
      effectiveActiveComps = removeOutlierComps(
        deduplicateComps([...effectiveActiveComps, ...manual.filter((r) => r.source === 'manual_active')])
      )
    }
  }

  // When there are zero relevant SOLD comps but real active-market data exists
  // (the exact bug found auditing HB-0085/86/87: 9-38 active comps sitting unused
  // while confidence/price both said "zero data"), derive a real, honestly-labeled
  // active-market estimate instead of falling straight to the speed-to-sell "no
  // data" narrative. Active-only estimates are asking-price data, not confirmed
  // sales, so the confidence score is halved and then capped below the lowest
  // sold-comp tier (35, versus calcConfidenceScore's own tiers of 40/60/75/90).
  const usingActiveFallback = effectiveSoldComps.length === 0 && effectiveActiveComps.length > 0

  const confidenceScore = usingActiveFallback
    ? Math.min(35, Math.round(calcConfidenceScore(effectiveActiveComps.length) * 0.5))
    : calcConfidenceScore(effectiveSoldComps.length)

  const prices = usingActiveFallback
    ? effectiveActiveComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
    : effectiveSoldComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPriceCents =
    prices.length === 0
      ? null
      : prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid]

  const discountPct = CATEGORY_DISCOUNT[step2.category?.toLowerCase() ?? ''] ?? 0.18
  const priceToMoveCents = suggestedPriceCents != null
    ? Math.round(suggestedPriceCents * (1 - discountPct))
    : null

  // Fetch existing price history to pass to methodology generation
  const { data: priceHistory } = await supabase
    .from('listing_price_events')
    .select('event_type, price_cents, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })

  const sources = usingActiveFallback
    ? [...new Set(effectiveActiveComps.map((r) => r.source))]
    : [...new Set(effectiveSoldComps.map((r) => r.source))]
  // Every other fetcher in this file degrades to an empty/null result on failure
  // rather than throwing (SerpAPI, Reddit, etc.) -- generatePricingMethodology's
  // internal runText() call has no such guard, so a transient Claude API error
  // here would otherwise crash the whole step after comps/pricing are already
  // computed. Fall back to a null methodology instead of losing that work.
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        usingActiveFallback ? effectiveActiveComps.length : effectiveSoldComps.length,
        sources,
        suggestedPriceCents,
        priceToMoveCents,
        discountPct,
        confidenceScore,
        retailResult?.retailPriceCents ?? null,
        priceHistory ?? [],
        apiKeys,
        usingActiveFallback
      ).catch((err) => {
        console.warn('generatePricingMethodology: failed, falling back to null', err instanceof Error ? err.message : String(err))
        // A plain null here is indistinguishable in the UI (EvidenceDrawer renders
        // nothing at all when pricingMethodology is falsy) from "no methodology was
        // ever attempted" -- a sentinel makes a genuine generation failure visible
        // to whoever's looking at the listing, not just to server logs.
        return '_Pricing methodology generation failed for this run — see server logs._'
      })
    : null

  await pushPipelineStep(listingId, {
    // pushPipelineStep floors pipeline_step atomically via a Postgres GREATEST() (migration
    // 0025) -- passing this step's own number is enough; the DB-side floor is what actually
    // prevents a "retry pricing" on an already-further-along listing from regressing it,
    // including under concurrent writers (see supabase-push.ts).
    pipeline_step: 3,
    confidence_score: confidenceScore,
    suggested_price_cents: suggestedPriceCents,
    price_to_move_cents: priceToMoveCents,
    price_to_move_discount_pct: discountPct * 100,
    retail_price_cents: retailResult?.retailPriceCents ?? null,
    retail_price_source: retailResult?.source ?? null,
    retail_promo_note: retailResult?.promoNote ?? null,
    lowest_active_price_cents: lowestActive?.sale_price_cents ?? null,
    lowest_active_url: lowestActive?.listing_url ?? null,
    lowest_active_source: lowestActive ? lowestActive.source.replace(/_active$/, '') : null,
    pricing_methodology: methodologyText,
  })

  // Insert initial price event if none exist yet (informational — never throws)
  try {
    const { data: existingEvents } = await supabase
      .from('listing_price_events')
      .select('id')
      .eq('listing_id', listingId)
      .limit(1)

    if ((existingEvents?.length ?? 0) === 0 && suggestedPriceCents != null) {
      await supabase.from('listing_price_events').insert({
        listing_id: listingId,
        event_type: 'initial',
        price_cents: suggestedPriceCents,
        note: `Initial pricing — ${usingActiveFallback ? effectiveActiveComps.length : effectiveSoldComps.length} comps, ${Math.round(confidenceScore)}% confidence`,
      })
    }
  } catch {
    // Informational — never block the pipeline
  }
}

/** Re-applies the dedup/outlier/median pricing math over whatever pricing_comps rows are
 * already persisted for a listing -- no external API calls, so it's safe to run instantly
 * any time a comp is added/edited/removed by hand (POST /api/listings/[id]/comps). Mirrors
 * the toInsert.length===0 reload branch in runStep3PricingResearch above, minus the parts
 * that need fresh external data or a Claude call: retail_price_cents, lowest_active_*, and
 * pricing_methodology are deliberately left untouched by a manual recalc. */
export async function recalculateListingPrice(listingId: string): Promise<{
  suggestedPriceCents: number | null
  confidenceScore: number
  compCount: number
}> {
  const supabase = getSupabaseAdmin()

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select('category')
    .eq('id', listingId)
    .single()
  if (listingError || !listing) {
    throw new Error(`recalculateListingPrice: listing not found — ${listingError?.message ?? listingId}`)
  }

  const { data: existingRows, error: reloadError } = await supabase
    .from('pricing_comps')
    .select('source, title, sale_price_cents, adjusted_price_cents, relevance_score')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (reloadError) {
    throw new Error(`recalculateListingPrice: pricing_comps reload failed — ${reloadError.message}`)
  }

  const existing = (existingRows ?? []) as Array<{
    source: string
    title: string
    sale_price_cents: number
    adjusted_price_cents: number
    relevance_score: number | null
  }>
  const effectiveSoldComps = removeOutlierComps(deduplicateComps(existing.filter((r) => !isActiveSource(r.source))))
  const effectiveActiveComps = removeOutlierComps(deduplicateComps(existing.filter((r) => isActiveSource(r.source))))

  const usingActiveFallback = effectiveSoldComps.length === 0 && effectiveActiveComps.length > 0
  const confidenceScore = usingActiveFallback
    ? Math.min(35, Math.round(calcConfidenceScore(effectiveActiveComps.length) * 0.5))
    : calcConfidenceScore(effectiveSoldComps.length)

  const prices = usingActiveFallback
    ? effectiveActiveComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
    : effectiveSoldComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPriceCents =
    prices.length === 0
      ? null
      : prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid]

  const discountPct = CATEGORY_DISCOUNT[(listing.category as string)?.toLowerCase() ?? ''] ?? 0.18
  const priceToMoveCents = suggestedPriceCents != null ? Math.round(suggestedPriceCents * (1 - discountPct)) : null

  await pushPipelineStep(listingId, {
    confidence_score: confidenceScore,
    suggested_price_cents: suggestedPriceCents,
    price_to_move_cents: priceToMoveCents,
    price_to_move_discount_pct: discountPct * 100,
  })

  return {
    suggestedPriceCents,
    confidenceScore,
    compCount: usingActiveFallback ? effectiveActiveComps.length : effectiveSoldComps.length,
  }
}
