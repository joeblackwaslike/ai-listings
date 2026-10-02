import { createHash } from 'crypto'
import { getSetting } from '@/lib/user-settings'

export type ProviderAuthUrlResult = { url: string } | { error: string }

// Builds the provider authorize URL for a platform-connect flow. Called from the "prepare" hop
// on the public callback domain (joeblack.nyc) rather than from the connect route, since that's
// where the anchor cookie needs to be set immediately before redirecting to the provider.
export async function buildProviderAuthUrl(
  platform: string,
  userId: string,
  state: string,
  codeVerifier: string | null
): Promise<ProviderAuthUrlResult> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!
  const callbackUri = `${siteUrl}/api/auth/callback/${platform}`

  const clientId = await getSetting(userId, `${platform}_client_id`)
  if (!clientId) return { error: 'missing_client_id' }

  if (platform === 'imgur') {
    const u = new URL('https://api.imgur.com/oauth2/authorize')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('state', state)
    return { url: u.toString() }
  }

  if (platform === 'etsy') {
    if (!codeVerifier) return { error: 'missing_code_verifier' }
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const u = new URL('https://www.etsy.com/oauth/connect')
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('redirect_uri', callbackUri)
    u.searchParams.set('scope', 'listings_r listings_w shops_r transactions_r')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('state', state)
    u.searchParams.set('code_challenge', codeChallenge)
    u.searchParams.set('code_challenge_method', 'S256')
    return { url: u.toString() }
  }

  if (platform === 'ebay') {
    const ruName = await getSetting(userId, 'ebay_ru_name')
    if (!ruName) return { error: 'missing_ru_name' }
    const scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.account',
    ].join(' ')
    const u = new URL('https://auth.ebay.com/oauth2/authorize')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('redirect_uri', ruName)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('scope', scopes)
    u.searchParams.set('state', state)
    return { url: u.toString() }
  }

  // mercari — OAuth endpoint TBD pending Mercari Shops API docs
  return { error: 'mercari_not_configured' }
}
