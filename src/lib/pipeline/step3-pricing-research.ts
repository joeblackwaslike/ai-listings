import { runText } from '@/lib/claude'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { VisionAnalysis } from './step2-vision-analysis'
import type { ApiKeys } from '@/lib/user-api-keys'
import { searchEbayActive } from './comps/ebay-browse'
import { conditionDelta, adjustForCondition, CATEGORY_DISCOUNT } from './pricing-adjust'

interface SerpShoppingResult {
  title: string
  link: string
  source?: string
  condition?: string
  price?: { extracted_value?: number }
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
  const query = `${brand} ${model}`
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_shopping')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('num', '10')
  url.searchParams.set('condition', 'used')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step3: SerpAPI shopping returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiShoppingResponse
  return data.shopping_results ?? []
}

async function fetchRetailPrice(
  brand: string,
  model: string,
  apiKey: string
): Promise<{ retailPriceCents: number; source: string; promoNote: string | null } | null> {
  try {
    const query = `${brand} ${model}`
    const url = new URL('https://serpapi.com/search')
    url.searchParams.set('engine', 'google_shopping')
    url.searchParams.set('q', query)
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('num', '5')
    url.searchParams.set('condition', 'new')

    const response = await fetch(url.toString())
    if (!response.ok) return null

    const data = (await response.json()) as SerpApiShoppingResponse
    const results = data.shopping_results ?? []

    const prices = results
      .map((r) => r.price?.extracted_value)
      .filter((v): v is number => typeof v === 'number' && v > 0)

    if (prices.length === 0) return null

    const sortedPrices = [...prices].sort((a, b) => a - b)
    const lowestPrice = sortedPrices[0]
    const retailPriceCents = Math.round(lowestPrice * 100)

    let promoNote: string | null = null
    if (prices.length >= 2) {
      const median =
        prices.length % 2 === 0
          ? (sortedPrices[Math.floor(prices.length / 2) - 1] + sortedPrices[Math.floor(prices.length / 2)]) / 2
          : sortedPrices[Math.floor(prices.length / 2)]
      if (lowestPrice < median * 0.85) {
        promoNote = 'Appears to be on sale'
      }
    }

    const lowestResult = results.find((r) => r.price?.extracted_value === lowestPrice)
    const source = lowestResult?.source ?? 'Google Shopping'

    return { retailPriceCents, source, promoNote }
  } catch {
    return null
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
  apiKeys: ApiKeys
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

  const prompt = `In 80–100 words, explain how this resale price was determined. Comp count: ${compCount}. Sources: ${sourcesStr}. Median adjusted price: ${suggestedStr}. Confidence: ${confidenceScore}%. Speed-to-sell price: ${priceToMoveStr} (${Math.round(discountPct * 100)}% below market median, typically sells in days vs weeks at list price).${retailStr}${historyStr} Return only the paragraph, no headings.`

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

const MERCARI_CONSUMER_API = 'https://api.mercari.com/v2/entities:search'

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
  score: number
  color: string | null
}

/** Parses the LLM's per-index `{score, color}` scoring response into a map of
 * every entry it could recover. Malformed JSON, a missing object, or a
 * non-numeric score all degrade to being dropped rather than thrown — callers
 * apply their own relevance threshold against the returned scores. */
export function parseRelevanceScores(text: string): Map<number, CompRelevance> {
  const entries = new Map<number, CompRelevance>()
  const match = /\{[\s\S]+\}/.exec(text)
  if (!match) return entries
  let parsed: Record<string, { score?: unknown; color?: unknown }>
  try {
    parsed = JSON.parse(match[0]) as Record<string, { score?: unknown; color?: unknown }>
  } catch {
    return entries
  }
  for (const [idx, entry] of Object.entries(parsed)) {
    const score = entry?.score
    if (typeof score !== 'number' || !Number.isFinite(score)) continue
    const color = typeof entry?.color === 'string' ? entry.color : null
    entries.set(Number(idx), { score, color })
  }
  return entries
}

/** Scores every comp 0-10 against the target item and extracts each title's own
 * color/variant descriptor. Returns relevance data for ALL input comps (not just
 * ones above threshold) — callers decide what counts as relevant for their use
 * case (e.g. active comps are inserted regardless of score, but still tagged). */
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
  try {
    for (let start = 0; start < comps.length; start += COMP_FILTER_BATCH) {
      const batch = comps.slice(start, start + COMP_FILTER_BATCH)
      const titlesBlock = batch.map((c, i) => `${start + i}. ${c.title}`).join('\n')
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
    }
    return scored
  } catch {
    return new Map(comps.map((_, i) => [i, { score: COMP_RELEVANCE_THRESHOLD, color: null }]))
  }
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
  }> = []

  for (const result of serpResults) {
    if (!result.price?.extracted_value) continue
    const priceCents = Math.round(result.price.extracted_value * 100)
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
      listing_url: result.link,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(priceCents, delta),
      relevance_score: null,
      color: null,
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
    })
  }

  for (const item of poshmarkSold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'poshmark', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
      relevance_score: null, color: null,
    })
  }

  for (const item of mercariSold) {
    const delta = conditionDelta(step2.condition, 'Not specified')
    compRows.push({
      listing_id: listingId, source: 'mercari', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: item.soldAt,
      listing_url: item.listingUrl, condition_delta: delta,
      adjusted_price_cents: adjustForCondition(item.priceCents, delta),
      relevance_score: null, color: null,
    })
  }

  // Active market comps — context only, excluded from sold-price median
  const activeRows: typeof compRows = []
  for (const item of ebayActive) {
    activeRows.push({
      listing_id: listingId, source: 'ebay_active', title: item.title,
      sale_price_cents: item.priceCents, condition: item.condition, sold_at: null,
      listing_url: item.url, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null,
    })
  }
  for (const item of poshmarkActive) {
    activeRows.push({
      listing_id: listingId, source: 'poshmark_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null,
    })
  }
  for (const item of mercariActive) {
    activeRows.push({
      listing_id: listingId, source: 'mercari_active', title: item.title,
      sale_price_cents: item.priceCents, condition: 'Not specified', sold_at: null,
      listing_url: item.listingUrl, condition_delta: 'same', adjusted_price_cents: item.priceCents,
      relevance_score: null, color: null,
    })
  }
  // Move any _active rows that ended up in compRows (from SerpAPI) into activeRows
  const soldRows = compRows.filter((r) => !r.source.endsWith('_active'))
  activeRows.push(...compRows.filter((r) => r.source.endsWith('_active')))

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
  const relevantActive = activeRows.filter((row) => (row.relevance_score ?? 0) >= COMP_RELEVANCE_THRESHOLD)
  const lowestActive = relevantActive.length > 0
    ? relevantActive.reduce((min, r) => (r.sale_price_cents < min.sale_price_cents ? r : min))
    : null

  // Deduplicate same-price clusters before relevance filtering (catches bulk-lot duplicate listings)
  const dedupedRows = deduplicateComps(soldRows)

  // Filter out irrelevant comps (wrong product type, wrong color/variant, unrelated merchandise)
  const soldRelevance = apiKeys.anthropic
    ? await scoreCompRelevance(dedupedRows, step2.brand, model, step2.category, step2.notableFeatures, apiKeys.anthropic)
    : null
  const relevantComps = dedupedRows
    .map((row, i) => {
      const relevance = soldRelevance?.get(i)
      return { ...row, relevance_score: relevance?.score ?? null, color: relevance?.color ?? null }
    })
    .filter((row) => (soldRelevance === null ? true : (row.relevance_score ?? 0) >= COMP_RELEVANCE_THRESHOLD))

  // Remove bimodal outliers / IQR outliers to cut bulk lots and anomalous prices
  const filteredComps = removeOutlierComps(relevantComps)

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
  const toInsert = [...filteredComps, ...activeRows]
  const insertedIds: string[] = []
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase.from('pricing_comps').insert(toInsert).select('id')
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
    insertedIds.push(...(inserted ?? []).map((row) => row.id as string))
  }

  // Only now that the fresh comps are safely stored, clear anything from a prior run.
  let deleteQuery = supabase.from('pricing_comps').delete().eq('listing_id', listingId)
  if (insertedIds.length > 0) {
    deleteQuery = deleteQuery.not('id', 'in', `(${insertedIds.join(',')})`)
  }
  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    throw new Error(`step3: pricing_comps delete failed — ${deleteError.message}`)
  }

  const confidenceScore = calcConfidenceScore(filteredComps.length)

  const prices = filteredComps.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
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

  const sources = [...new Set(filteredComps.map((r) => r.source))]
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        filteredComps.length,
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

  await pushPipelineStep(listingId, {
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
        note: `Initial pricing — ${filteredComps.length} comps, ${Math.round(confidenceScore)}% confidence`,
      })
    }
  } catch {
    // Informational — never block the pipeline
  }
}
