// SoldComps (sold-comps.com) -- third-party eBay sold-listings API. Replaces the
// eBay Finding API (decommissioned 2026-02-05) and Marketplace Insights API
// (structurally denied to individual developers, see ai-listings-9nh) as the
// sold-price comp source. No OAuth/approval process -- a bearer API key from a
// free account. Free tier: 100 searches/month.
const SOLDCOMPS_API_URL = 'https://api.sold-comps.com/v1/scrape'

export interface SoldListing {
  title: string
  priceCents: number
  soldAt: string
  listingUrl: string
  condition: string
}

interface SoldCompsItem {
  title?: string | null
  soldPrice?: string | null
  endedAt?: string | null // YYYY-MM-DD
  url?: string | null
  condition?: string | null
}

interface SoldCompsResponse {
  items?: SoldCompsItem[]
}

export async function searchEbaySoldComps(query: string, apiKey: string): Promise<SoldListing[]> {
  if (!apiKey) return []

  try {
    const url = new URL(SOLDCOMPS_API_URL)
    url.searchParams.set('keyword', query)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      // 429/402 specifically means the free-tier 100/month cap is exhausted -- distinct
      // from a transient failure or an expired/bad key, so operators can tell them apart
      // instead of both looking like "no comps found" in the logs.
      if (res.status === 429 || res.status === 402) {
        console.warn(`[ebay-soldcomps] quota exhausted (HTTP ${res.status}) for "${query}"`)
      } else {
        console.warn(`[ebay-soldcomps] HTTP ${res.status} for "${query}"`)
      }
      return []
    }

    const data = (await res.json()) as SoldCompsResponse
    return (data.items ?? [])
      .filter((it) => it.title && it.soldPrice && it.endedAt && it.url)
      .map((it) => {
        // endedAt is date-only (YYYY-MM-DD) -- validate before toISOString(), which
        // throws RangeError on an Invalid Date and would otherwise lose the batch.
        const parsedDate = it.endedAt ? new Date(it.endedAt) : null
        const soldAt = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null
        const price = it.soldPrice ? parseFloat(it.soldPrice) : NaN
        return {
          title: it.title ?? '',
          priceCents: Number.isFinite(price) ? Math.round(price * 100) : 0,
          soldAt,
          listingUrl: it.url ?? '',
          condition: it.condition ?? 'Not specified',
        }
      })
      .filter((it): it is SoldListing => it.priceCents > 0 && it.soldAt !== null)
  } catch (err) {
    console.warn(`[ebay-soldcomps] error for "${query}":`, err instanceof Error ? err.message : String(err))
    return []
  }
}
