// eBay Marketplace Insights API — SOLD listings.
// Requires the buy.marketplace.insights scope (separate eBay developer approval).
// Returns [] gracefully if the scope isn't approved yet or on any error, so the
// pipeline degrades silently while scope approval is pending.
import { getEbayAppToken, EBAY_SCOPE_INSIGHTS } from './ebay-oauth'

export interface SoldListing {
  title: string
  priceCents: number
  soldAt: string
  listingUrl: string
}

interface InsightsItemSale {
  title?: string
  price?: { value?: string }
  lastSoldDate?: string
  itemWebUrl?: string
}

export async function searchEbayInsights(query: string, limit = 50): Promise<SoldListing[]> {
  const token = await getEbayAppToken(EBAY_SCOPE_INSIGHTS)
  if (!token) return []

  try {
    const url = new URL('https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(limit))

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.warn(`[ebay-insights] item_sales/search HTTP ${res.status} for "${query}"`)
      return []
    }

    const data = (await res.json()) as { itemSales?: InsightsItemSale[] }
    return (data.itemSales ?? [])
      .map((it) => {
        const price = it.price?.value ? parseFloat(it.price.value) : NaN
        return {
          title: it.title ?? '',
          priceCents: Number.isFinite(price) ? Math.round(price * 100) : 0,
          soldAt: it.lastSoldDate ?? '',
          listingUrl: it.itemWebUrl ?? '',
        }
      })
      .filter((it) => it.title && it.priceCents > 0 && it.soldAt && it.listingUrl)
  } catch (err) {
    console.warn(`[ebay-insights] error for "${query}":`, (err as Error).message)
    return []
  }
}
