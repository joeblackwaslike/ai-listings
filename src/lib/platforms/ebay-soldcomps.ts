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

// SOLDCOMPS_API_KEY can hold multiple comma-separated keys, same convention as
// SERPAPI_API_KEY (serpapi-client.ts) -- so one account's exhausted free-tier 100/month
// cap doesn't take down every SoldComps-dependent pricing lookup (ai-listings, 2026-08-23).
function parseSoldCompsKeys(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

async function fetchSoldComps(query: string, apiKey: string): Promise<Response> {
  const url = new URL(SOLDCOMPS_API_URL)
  url.searchParams.set('keyword', query)
  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
}

export async function searchEbaySoldComps(query: string, rawApiKey: string): Promise<SoldListing[]> {
  const keys = parseSoldCompsKeys(rawApiKey)
  if (keys.length === 0) return []

  try {
    let res: Response | null = null
    for (const key of keys) {
      res = await fetchSoldComps(query, key)
      // 429/402 specifically means the free-tier 100/month cap is exhausted -- distinct
      // from a transient failure or an expired/bad key, so operators can tell them apart
      // instead of both looking like "no comps found" in the logs. Try the next key on
      // quota exhaustion; any other non-ok status is returned as-is below.
      if (res.status === 429 || res.status === 402) {
        console.warn(`[ebay-soldcomps] quota exhausted (HTTP ${res.status}) for "${query}"`)
        continue
      }
      break
    }
    if (!res) return []

    if (!res.ok) {
      if (res.status !== 429 && res.status !== 402) {
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
        // Live-tested response format is a bare numeric string ("380", "29.99") with no
        // currency symbol or thousands separator -- strip both anyway so a future format
        // change (e.g. "$1,234.56") degrades to a correct parse instead of a silently
        // dropped or truncated-at-the-comma price.
        const price = it.soldPrice ? parseFloat(it.soldPrice.replace(/[^0-9.-]/g, '')) : NaN
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
