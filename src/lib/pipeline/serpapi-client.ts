// Shared multi-key fallback for every SerpAPI-backed pipeline call (step1's Google
// Lens product ID, step3's shopping/retail/eBay/TheRealReal comps). SERPAPI_API_KEY
// can hold multiple comma-separated keys so one account's exhausted monthly quota
// doesn't take down every SerpAPI-dependent step -- confirmed 2026-08-23: an
// exhausted key caused several listings' Google Lens lookup to silently return zero
// matches (not a hard failure), leaving step2's vision analysis to guess the
// specific collection/line without reverse-image grounding -- it got at least 3 of
// them wrong (ai-listings-3ec, ai-listings-bvo, ai-listings-svg).

export function parseSerpApiKeys(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

// Tries each key in order, advancing to the next only on a quota/rate-limit
// response (429 "ran out of searches", 402). Any other failure (network error,
// 5xx, timeout) is thrown immediately rather than masked by a retry -- multiple
// keys fix quota exhaustion, not a genuinely down/misbehaving upstream.
export async function fetchSerpApi(
  buildUrl: (apiKey: string) => URL,
  rawApiKeys: string,
  timeoutMs = 15_000
): Promise<Response | null> {
  const keys = parseSerpApiKeys(rawApiKeys)
  if (keys.length === 0) return null

  let lastQuotaResponse: Response | null = null
  for (const key of keys) {
    const res = await fetch(buildUrl(key).toString(), { signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 429 || res.status === 402) {
      lastQuotaResponse = res
      continue
    }
    return res
  }
  // Every key hit a quota/rate-limit response -- return the last one so callers'
  // existing !response.ok handling applies unchanged.
  return lastQuotaResponse
}
