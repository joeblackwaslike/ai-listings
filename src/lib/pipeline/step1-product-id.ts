import type { ListingCategory } from '@/types/listings'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'

interface LensMatch {
  title: string
  link: string
  thumbnail: string
  source: string
  price?: { value: string; extracted_value: number; currency: string }
}

interface SerpApiLensResponse {
  search_metadata: { status: string }
  visual_matches?: LensMatch[]
  knowledge_graph?: {
    title?: string
    type?: string
    description?: string
    attributes?: Record<string, string>
  }
  error?: string
}

export interface Step1Result {
  ok: true
  title: string
  brand: string
  category: ListingCategory
  sku: string
  lensMatches: LensMatch[]
  rawLensResponse: SerpApiLensResponse
}

function inferCategory(matches: LensMatch[]): ListingCategory {
  const allTitles = matches.map((m) => m.title.toLowerCase()).join(' ')

  if (/bag|purse|handbag|clutch|tote|satchel|crossbody/.test(allTitles))
    return 'handbag'
  if (/sneaker|shoe|boot|sandal|louboutin|jordan|nike air/.test(allTitles))
    return 'sneakers'
  if (
    /phone|laptop|tablet|watch|camera|headphone|iphone|macbook|airpod/.test(
      allTitles
    )
  )
    return 'electronics'
  if (/ring|necklace|bracelet|earring|pendant|diamond|gold jewelry/.test(allTitles))
    return 'jewelry'
  if (
    /shirt|dress|jacket|coat|pant|jeans|skirt|blouse|sweater|hoodie|legging/.test(
      allTitles
    )
  )
    return 'clothing'

  return 'other'
}

function inferBrand(matches: LensMatch[]): string {
  const luxuryBrands = [
    'Chanel',
    'Louis Vuitton',
    'Gucci',
    'Hermès',
    'Prada',
    'Balenciaga',
    'Christian Louboutin',
    'Dior',
    'Burberry',
    'Versace',
    'Saint Laurent',
    'Bottega Veneta',
  ]
  const sneakerBrands = ['Nike', 'Jordan', 'Adidas', 'New Balance', 'Puma', 'Vans']
  const allBrands = [...luxuryBrands, ...sneakerBrands]

  const allTitles = matches.map((m) => m.title).join(' ')

  for (const brand of allBrands) {
    if (allTitles.toLowerCase().includes(brand.toLowerCase())) {
      return brand
    }
  }

  const firstTitle = matches[0]?.title ?? ''
  return firstTitle.split(' ')[0] ?? 'Unknown'
}

export async function runStep1ProductId(
  listingId: string,
  photoUrl: string
): Promise<Step1Result> {
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_lens')
  url.searchParams.set('url', photoUrl)
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step1: SerpAPI returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiLensResponse

  if (data.error) {
    throw new Error(`step1: SerpAPI error — ${data.error}`)
  }

  const matches = data.visual_matches ?? []

  if (matches.length === 0) {
    throw new Error('step1: SerpAPI returned zero visual matches')
  }

  const category = inferCategory(matches)
  const brand = inferBrand(matches)
  const title = data.knowledge_graph?.title ?? matches[0].title

  const supabase = getSupabaseAdmin()
  const prefix = {
    handbag: 'HB',
    clothing: 'CL',
    sneakers: 'SN',
    electronics: 'EL',
    jewelry: 'JW',
    collectibles: 'CO',
    other: 'OT',
  }[category]

  const { data: skuData, error: skuError } = await supabase.rpc('generate_sku', {
    prefix,
  })

  if (skuError) {
    throw new Error(`step1: generate_sku failed — ${skuError.message}`)
  }

  const sku = skuData as string

  await pushPipelineStep(listingId, {
    pipeline_step: 1,
    sku,
    category,
    brand,
    intake_meta: { lensMatches: matches, rawLensResponse: data },
  })

  return {
    ok: true,
    title,
    brand,
    category,
    sku,
    lensMatches: matches,
    rawLensResponse: data,
  }
}
