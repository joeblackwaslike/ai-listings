// Mints + caches eBay application access tokens (client_credentials flow).
// Used by the Browse (active listings) and Marketplace Insights (sold data) clients.
// Cache is keyed by scope so the basic Browse scope and the restricted Insights
// scope don't clobber each other.

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export const EBAY_SCOPE_BASE = 'https://api.ebay.com/oauth/api_scope'
export const EBAY_SCOPE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights'

export async function getEbayAppToken(scope: string = EBAY_SCOPE_BASE): Promise<string | null> {
  const id = process.env.EBAY_CLIENT_ID
  const secret = process.env.EBAY_CLIENT_SECRET
  if (!id || !secret) return null

  const cached = tokenCache.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

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
    if (!res.ok) return null

    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null

    tokenCache.set(scope, {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
    })
    return json.access_token
  } catch {
    return null
  }
}
