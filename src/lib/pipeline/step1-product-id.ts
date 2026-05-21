import type { ListingCategory } from '@/types/listings'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toPublicUrl } from './to-public-url'

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

export interface ProductIdData {
  ok: true
  title: string
  brand: string
  category: ListingCategory
  sku: string
  lensMatches: Pick<LensMatch, 'title' | 'source' | 'price'>[]
}

function inferCategory(matches: LensMatch[]): ListingCategory {
  const allTitles = matches.map((m) => m.title.toLowerCase()).join(' ')

  if (/bag|purse|handbag|clutch|tote|satchel|crossbody/.test(allTitles))
    return 'handbag'
  if (/sneaker|shoe|boot|sandal|louboutin|jordan|nike air/.test(allTitles))
    return 'sneakers'
  if (/watch|timepiece|movado|rolex|omega|seiko|casio|cartier.*watch|tudor|tag.?heuer|longines|hublot/.test(allTitles))
    return 'watches'
  if (/mechanical.?keyboard|keyboard|keycap|switch.*keyboard|tkl|65%|75%|60%|40%|gmk|kbd|endgame.?gear|gmmk/.test(allTitles))
    return 'keyboards'
  if (
    /phone|laptop|tablet|camera|headphone|iphone|macbook|airpod/.test(allTitles)
  )
    return 'electronics'
  if (/ring|necklace|bracelet|earring|pendant|diamond|gold jewelry/.test(allTitles))
    return 'jewelry'
  if (
    /shirt|dress|jacket|coat|pant|jeans|skirt|blouse|sweater|hoodie|legging/.test(allTitles)
  )
    return 'clothing'

  return 'other'
}

function inferBrand(matches: LensMatch[]): string {
  const luxuryBrands = [
    'Chanel', 'Louis Vuitton', 'Gucci', 'Hermès', 'Prada', 'Balenciaga',
    'Christian Louboutin', 'Dior', 'Burberry', 'Versace', 'Saint Laurent', 'Bottega Veneta',
  ]
  const sneakerBrands = ['Nike', 'Jordan', 'Adidas', 'New Balance', 'Puma', 'Vans']
  const allBrands = [...luxuryBrands, ...sneakerBrands]
  const allTitles = matches.map((m) => m.title).join(' ')

  for (const brand of allBrands) {
    if (allTitles.toLowerCase().includes(brand.toLowerCase())) return brand
  }

  return matches[0]?.title.split(' ')[0] ?? 'Unknown'
}


export async function runStep1ProductId(
  listingId: string,
  photoUrl: string,
  apiKeys: ApiKeys
): Promise<ProductIdData> {
  const publicPhotoUrl = await toPublicUrl(photoUrl)

  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_lens')
  url.searchParams.set('url', publicPhotoUrl)
  url.searchParams.set('api_key', apiKeys.serpapi)

  console.log(`[step1] calling SerpAPI Google Lens with url=${publicPhotoUrl}`)
  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step1: SerpAPI returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiLensResponse
  console.log(`[step1] SerpAPI response status: ${data.search_metadata?.status}, matches: ${data.visual_matches?.length ?? 0}, error: ${data.error ?? 'none'}`)

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

  console.log(`[step1] identified: title="${title}" brand="${brand}" category="${category}"`)

  const supabase = getSupabaseAdmin()
  const prefix = {
    handbag: 'HB', clothing: 'CL', sneakers: 'SN',
    electronics: 'EL', jewelry: 'JW', collectibles: 'CO',
    watches: 'WA', keyboards: 'KB', other: 'OT',
  }[category]

  const { data: skuData, error: skuError } = await supabase.rpc('generate_sku', { prefix })
  if (skuError) throw new Error(`step1: generate_sku failed — ${skuError.message}`)
  const sku = skuData as string

  await pushPipelineStep(listingId, {
    pipeline_step: 1,
    sku,
    category,
    brand,
    intake_meta: { lensMatches: matches, rawLensResponse: data },
  })

  // Return only what downstream steps need — rawLensResponse is already stored in the DB
  // and is too large (~59 matches × full JSON) to fit in Inngest's step memoization payload.
  const topMatches = matches.slice(0, 5).map((m: LensMatch) => ({
    title: m.title,
    source: m.source,
    price: m.price,
  }))
  return { ok: true, title, brand, category, sku, lensMatches: topMatches }
}
