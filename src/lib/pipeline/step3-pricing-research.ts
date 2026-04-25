import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'

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
  model: string
): Promise<SerpEbayResult[]> {
  const query = `${brand} ${model} ${category}`
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'ebay')
  url.searchParams.set('_nkw', query)
  url.searchParams.set('LH_Sold', '1')
  url.searchParams.set('LH_Complete', '1')
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step3: SerpAPI eBay returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpEbayResponse
  return data.organic_results ?? []
}

async function fetchSerpComps(
  brand: string,
  model: string
): Promise<SerpShoppingResult[]> {
  const query = `${brand} ${model} resale sold price site:poshmark.com OR site:therealreal.com`
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_shopping')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)
  url.searchParams.set('num', '10')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step3: SerpAPI shopping returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiShoppingResponse
  return data.shopping_results ?? []
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
  step2: Step2Result,
  model: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const [ebayItems, serpResults] = await Promise.all([
    fetchSerpEbayComps(step2.brand, step2.category, model),
    step2.isLuxury ? fetchSerpComps(step2.brand, model) : Promise.resolve([]),
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
