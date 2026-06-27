// Mints + caches eBay application access tokens (client_credentials flow).
// Used by the Browse (active listings) and Marketplace Insights (sold data) clients.
// Cache is keyed by scope so the basic Browse scope and the restricted Insights
// scope don't clobber each other. An in-flight map dedups concurrent mints so a
// burst of parallel pricing jobs doesn't stampede the token endpoint.

const tokenCache = new Map<string, { token: string; expiresAt: number }>()
const inflight = new Map<string, Promise<string | null>>()

export const EBAY_SCOPE_BASE = 'https://api.ebay.com/oauth/api_scope'
export const EBAY_SCOPE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights'

async function mintToken(scope: string, id: string, secret: string): Promise<string | null> {
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString('base64')
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
    })
    if (!res.ok) {
      console.warn(`[ebay-oauth] token mint failed: HTTP ${res.status} for scope ${scope}`)
      return null
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null
    tokenCache.set(scope, {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
    })
    return json.access_token
  } catch (err) {
    console.warn(`[ebay-oauth] token mint error for scope ${scope}:`, (err as Error).message)
    return null
  }
}

export async function getEbayAppToken(scope: string = EBAY_SCOPE_BASE): Promise<string | null> {
  const id = process.env.EBAY_CLIENT_ID
  const secret = process.env.EBAY_CLIENT_SECRET
  if (!id || !secret) return null

  const cached = tokenCache.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  // Coalesce concurrent mints for the same scope onto a single request.
  const existing = inflight.get(scope)
  if (existing) return existing

  const p = mintToken(scope, id, secret).finally(() => inflight.delete(scope))
  inflight.set(scope, p)
  return p
}
