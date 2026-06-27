// eBay Browse API — ACTIVE listings (works with the app's existing credentials).
// Used to surface the lowest live exact-item price as a fast-sale data point.
import { getEbayAppToken } from './ebay-oauth'

export interface ActiveListing {
  title: string
  priceCents: number
  url: string
  condition: string
}

interface BrowseItemSummary {
  title?: string
  price?: { value?: string }
  itemWebUrl?: string
  condition?: string
}

export async function searchEbayActive(query: string, limit = 20): Promise<ActiveListing[]> {
  const token = await getEbayAppToken()
  if (!token) return []

  try {
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('sort', 'price') // ascending by price + shipping
    // Fixed-price only — auction "price" is the current bid, which understates the real ask.
    url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}')

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    })
    if (!res.ok) return []

    const data = (await res.json()) as { itemSummaries?: BrowseItemSummary[] }
    return (data.itemSummaries ?? [])
      .map((it) => ({
        title: it.title ?? '',
        priceCents: it.price?.value ? Math.round(parseFloat(it.price.value) * 100) : 0,
        url: it.itemWebUrl ?? '',
        condition: it.condition ?? 'Not specified',
      }))
      .filter((it) => it.title && it.priceCents > 0 && it.url)
  } catch {
    return []
  }
}
