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
  redditCreds: {
    clientId: string
    clientSecret: string
    refreshToken: string
    userAgent: string
  },
  anthropicApiKey: string
): Promise<Array<{
  source: string
  title: string
  sale_price_cents: number
  sold_at: string | null
  listing_url: string
}>> {
  try {
    // Dynamic import to avoid bundling issues with snoowrap's CommonJS deps
    const Snoowrap = (await import('snoowrap')).default
    const r = new Snoowrap({
      userAgent: redditCreds.userAgent,
      clientId: redditCreds.clientId,
      clientSecret: redditCreds.clientSecret,
      refreshToken: redditCreds.refreshToken,
    })

    const searchQuery = `[H] ${brand} ${model}`
    const posts = await r.getSubreddit('mechmarket').search({
      query: searchQuery,
      sort: 'new',
      limit: 25,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    if (!posts || posts.length === 0) return []

    const top = (posts as RedditPost[]).slice(0, 15)
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
      // Strip markdown fences if Claude wrapped it anyway
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
    // Never throw — Reddit is a best-effort enrichment
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

  const redditCreds =
    isKeyboard &&
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_REFRESH_TOKEN
      ? {
          clientId: process.env.REDDIT_CLIENT_ID,
          clientSecret: process.env.REDDIT_CLIENT_SECRET,
          refreshToken: process.env.REDDIT_REFRESH_TOKEN,
          userAgent: process.env.REDDIT_USER_AGENT ?? 'ai-listings-bot/1.0 (by /u/joeblackwaslike)',
        }
      : null

  const [ebayItems, serpResults, redditComps] = await Promise.all([
    fetchSerpEbayComps(step2.brand, step2.category, model, apiKeys.serpapi),
    fetchSerpComps(step2.brand, model, apiKeys.serpapi),
    redditCreds && apiKeys.anthropic
      ? fetchRedditMechmarketComps(step2.brand, model, redditCreds, apiKeys.anthropic)
      : Promise.resolve([]),
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

  await pushPipelineStep(listingId, {
    pipeline_step: 3,
    confidence_score: confidenceScore,
    suggested_price_cents: suggestedPriceCents,
  })
}
