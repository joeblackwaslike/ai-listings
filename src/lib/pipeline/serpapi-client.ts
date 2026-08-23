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

// SerpAPI's actual quota-exhausted behavior, confirmed live: a fully-exhausted key
// returns HTTP 200 with `{"error": "Your account has run out of searches..."}` in the
// body, not a 429/402 -- this is the exact incident documented in the file comment
// above (Google Lens silently returning zero matches). A 429/402-only rotation check
// never catches it.
const QUOTA_ERROR_PATTERN = /run out of searches|monthly search|out of searches|quota|too many requests/i

async function isQuotaExhaustedBody(res: Response): Promise<boolean> {
  if (!res.ok) return false
  try {
    // .clone() so the body stream is still available for the eventual caller's own
    // res.json() -- reading the original would consume it.
    const body = (await res.clone().json()) as { error?: string }
    return typeof body.error === 'string' && QUOTA_ERROR_PATTERN.test(body.error)
  } catch {
    // Not JSON, or no `error` field -- not a quota response by this check.
    return false
  }
}

// Tries each key in order, advancing to the next on a quota/rate-limit response --
// either a 429/402 status, or a 200 whose body carries SerpAPI's quota-exhausted error
// message (see isQuotaExhaustedBody above). Any other failure (network error, 5xx,
// timeout) is thrown immediately rather than masked by a retry -- multiple keys fix
// quota exhaustion, not a genuinely down/misbehaving upstream.
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
    if (res.status === 429 || res.status === 402 || (await isQuotaExhaustedBody(res))) {
      lastQuotaResponse = res
      continue
    }
    return res
  }
  // Every key hit a quota/rate-limit response -- return the last one so callers'
  // existing !response.ok / data.error handling applies unchanged.
  return lastQuotaResponse
}
