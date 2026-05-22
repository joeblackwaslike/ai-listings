import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { VisionAnalysis } from './step2-vision-analysis'
import type { ApiKeys } from '@/lib/user-api-keys'

interface SerpEbayResult {
  title: string
  price?: { raw: string; extracted: number }
  condition?: string
  link: string
  extensions?: string[]
}

interface SerpEbayResponse {
  organic_results?: SerpEbayResult[]
  error?: string
}

interface SerpShoppingResult {
  title: string
  price: { value: string; extracted_value: number; currency: string }
  link: string
  source: string
  condition?: string
}

interface SerpApiShoppingResponse {
  shopping_results?: SerpShoppingResult[]
  error?: string
}

async function fetchSerpEbayComps(
  brand: string,
  category: string,
  model: string,
  apiKey: string,
  refNumber?: string
): Promise<SerpEbayResult[]> {
  const query = refNumber
    ? `${brand} ${model} ${refNumber}`
    : `${brand} ${model} ${category}`
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'ebay')
  url.searchParams.set('_nkw', query)
  url.searchParams.set('LH_Sold', '1')
  url.searchParams.set('LH_Complete', '1')
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step3: SerpAPI eBay returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpEbayResponse
  return data.organic_results ?? []
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

  const client = new Anthropic({ apiKey: apiKeys.anthropic })
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''
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

    const client = new Anthropic({ apiKey: anthropicApiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extract selling prices for ${brand} ${model} from these mechmarket posts. Return a JSON array only (no prose, no markdown fences): [{ "title": string, "price_cents": number }]. Only include posts that appear to be actual sale listings with a clear price. If no qualifying posts exist, return [].

${postsText}`,
        },
      ],
    })

    const raw = response.content[0]
    if (raw.type !== 'text') return []

    let extracted: RedditExtracted[] = []
    try {
      const json = raw.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
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

function conditionDelta(
  listingCondition: string,
  compCondition: string
): 'same' | 'better' | 'worse' {
  const conditionRank: Record<string, number> = {
    new_with_tags: 8,
    new_without_tags: 7,
    like_new: 6,
    very_good: 5,
    good: 4,
    fair: 3,
    poor: 2,
    for_parts: 1,
  }
  const listingRank = conditionRank[listingCondition] ?? 4
  const compRank = compCondition.toLowerCase().includes('like new')
    ? 6
    : compCondition.toLowerCase().includes('good')
      ? 4
      : compCondition.toLowerCase().includes('new')
        ? 7
        : 4

  if (listingRank > compRank) return 'better'
  if (listingRank < compRank) return 'worse'
  return 'same'
}

function adjustForCondition(priceCents: number, delta: 'same' | 'better' | 'worse'): number {
  if (delta === 'better') return Math.round(priceCents * 1.15)
  if (delta === 'worse') return Math.round(priceCents * 0.85)
  return priceCents
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

async function filterRelevantComps(
  comps: Array<{ title: string }>,
  brand: string,
  model: string,
  category: string,
  notableFeatures: string[],
  anthropicApiKey: string
): Promise<Set<number>> {
  if (comps.length === 0) return new Set()
  const keepIndices = new Set<number>()
  const featureHints = notableFeatures.slice(0, 4).join(', ')
  const targetDesc = featureHints
    ? `"${brand} ${model}" (${category}) — key attributes: ${featureHints}`
    : `"${brand} ${model}" (${category})`
  try {
    const client = new Anthropic({ apiKey: anthropicApiKey })
    for (let start = 0; start < comps.length; start += COMP_FILTER_BATCH) {
      const batch = comps.slice(start, start + COMP_FILTER_BATCH)
      const titlesBlock = batch.map((c, i) => `${start + i}. ${c.title}`).join('\n')
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Score each title by how well it matches this specific item: ${targetDesc}.

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

Return ONLY a JSON object mapping index → score. Example: {"0":8,"1":2,"3":9}

Titles:
${titlesBlock}`,
          },
        ],
      })
      const textBlock = response.content.find((b) => b.type === 'text')
      if (textBlock?.type !== 'text') continue
      const match = /\{[^}]+\}/.exec(textBlock.text)
      if (!match) continue
      let scores: Record<string, number>
      try {
        scores = JSON.parse(match[0]) as Record<string, number>
      } catch {
        continue
      }
      for (const [idx, score] of Object.entries(scores)) {
        if (score >= COMP_RELEVANCE_THRESHOLD) keepIndices.add(Number(idx))
      }
    }
    return keepIndices
  } catch {
    return new Set(comps.map((_, i) => i))
  }
}

export async function runStep3PricingResearch(
  listingId: string,
  step2: VisionAnalysis,
  model: string,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const isKeyboard = step2.category?.toLowerCase() === 'keyboards'

  // For watches, extract ref number from notableFeatures for more specific eBay query
  const isWatch = step2.category?.toLowerCase() === 'watches'
  const refNumber = isWatch
    ? step2.notableFeatures.map((f) => /ref\.?\s*([\w.-]+)/i.exec(f)?.[1]).find(Boolean)
    : undefined

  const [ebayItems, serpResults, redditComps, retailResult] = await Promise.all([
    fetchSerpEbayComps(step2.brand, step2.category, model, apiKeys.serpapi, refNumber),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    isKeyboard && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, apiKeys.anthropic)
      : Promise.resolve([]),
    fetchRetailPrice(step2.brand, model, apiKeys.serpapi),
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
  }> = []

  for (const item of ebayItems) {
    const priceCents = item.price?.extracted ? Math.round(item.price.extracted * 100) : 0
    if (priceCents === 0) continue
    const condition = item.condition ?? 'Not specified'
    const delta = conditionDelta(step2.condition, condition)
    compRows.push({
      listing_id: listingId,
      source: 'ebay',
      title: item.title,
      sale_price_cents: priceCents,
      condition,
      sold_at: null,
      listing_url: item.link,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(priceCents, delta),
    })
  }

  for (const result of serpResults) {
    if (!result.price?.extracted_value) continue
    const priceCents = Math.round(result.price.extracted_value * 100)
    const source = result.source?.toLowerCase().includes('poshmark')
      ? 'poshmark'
      : result.source?.toLowerCase().includes('therealreal')
        ? 'therealreal'
        : 'google'
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
    })
  }

  // Deduplicate same-price clusters before relevance filtering (catches bulk-lot duplicate listings)
  const dedupedRows = deduplicateComps(compRows)

  // Filter out irrelevant comps (wrong product type, wrong color/variant, unrelated merchandise)
  const relevantIndices = apiKeys.anthropic
    ? await filterRelevantComps(dedupedRows, step2.brand, model, step2.category, step2.notableFeatures, apiKeys.anthropic)
    : new Set(dedupedRows.map((_, i) => i))
  const relevantComps = dedupedRows.filter((_, i) => relevantIndices.has(i))

  // Remove bimodal outliers / IQR outliers to cut bulk lots and anomalous prices
  const filteredComps = removeOutlierComps(relevantComps)

  if (filteredComps.length > 0) {
    const { error } = await supabase.from('pricing_comps').insert(filteredComps)
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
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

  const CATEGORY_DISCOUNT: Record<string, number> = {
    handbag: 0.15,
    watches: 0.12,
    electronics: 0.20,
    clothing: 0.25,
    sneakers: 0.20,
    jewelry: 0.15,
    small_leather_goods: 0.18,
    keyboards: 0.15,
    collectibles: 0.15,
  }
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
