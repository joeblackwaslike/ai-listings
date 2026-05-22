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
  apiKey: string
): Promise<SerpEbayResult[]> {
  const query = `${brand} ${model} ${category}`
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
  sold_at_approx: string | null
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
          content: `Extract selling prices for ${brand} ${model} from these mechmarket posts. Return a JSON array only (no prose, no markdown fences): [{ "title": string, "price_cents": number, "sold_at_approx": string | null }]. Only include posts that appear to be actual sale listings with a clear price. If no qualifying posts exist, return [].

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
          sold_at: e.sold_at_approx ?? null,
          listing_url: matchedPost?.url ?? `https://www.reddit.com/r/mechmarket/search/?q=${encodeURIComponent(brand + ' ' + model)}`,
        }
      })
  } catch {
    return []
  }
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

export async function runStep3PricingResearch(
  listingId: string,
  step2: VisionAnalysis,
  model: string,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const isKeyboard = step2.category?.toLowerCase() === 'keyboards'

  const [ebayItems, serpResults, redditComps, retailResult] = await Promise.all([
    fetchSerpEbayComps(step2.brand, step2.category, model, apiKeys.serpapi),
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

  if (compRows.length > 0) {
    const { error } = await supabase.from('pricing_comps').insert(compRows)
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
  }

  const confidenceScore = calcConfidenceScore(compRows.length)

  const prices = compRows.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
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

  const sources = [...new Set(compRows.map((r) => r.source))]
  const methodologyText = apiKeys.anthropic
    ? await generatePricingMethodology(
        compRows.length,
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
        note: `Initial pricing — ${compRows.length} comps, ${Math.round(confidenceScore)}% confidence`,
      })
    }
  } catch {
    // Informational — never block the pipeline
  }
}
