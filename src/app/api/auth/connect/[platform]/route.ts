import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'

const SUPPORTED = new Set(['imgur', 'etsy', 'ebay', 'mercari'])

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!
  const settingsUrl = `${siteUrl}/settings/platforms`

  if (!user) return Response.redirect(`${siteUrl}/login`)

  const platform = new URL(req.url).pathname.split('/').at(-1)!
  if (!SUPPORTED.has(platform)) {
    return Response.redirect(`${settingsUrl}?error=unknown_platform`)
  }

  const callbackUri = `${siteUrl}/api/auth/callback/${platform}`
  const cookieStore = await cookies()

  const clientId = await getSetting(user.id, `${platform}_client_id`)
  if (!clientId) {
    return Response.redirect(`${settingsUrl}?error=missing_client_id`)
  }

  const state = randomBytes(16).toString('hex')
  cookieStore.set(`oauth_state_${platform}`, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  let authUrl: string

  if (platform === 'imgur') {
    const u = new URL('https://api.imgur.com/oauth2/authorize')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('state', state)
    authUrl = u.toString()

  } else if (platform === 'etsy') {
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    cookieStore.set('etsy_code_verifier', codeVerifier, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    const u = new URL('https://www.etsy.com/oauth/connect')
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('redirect_uri', callbackUri)
    u.searchParams.set('scope', 'listings_r listings_w shops_r transactions_r')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('state', state)
    u.searchParams.set('code_challenge', codeChallenge)
    u.searchParams.set('code_challenge_method', 'S256')
    authUrl = u.toString()

  } else if (platform === 'ebay') {
    const ruName = await getSetting(user.id, 'ebay_ru_name')
    if (!ruName) return Response.redirect(`${settingsUrl}?error=missing_ru_name`)
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
    authUrl = u.toString()

  } else {
    // mercari — OAuth endpoint TBD pending Mercari Shops API docs
    return Response.redirect(`${settingsUrl}?error=mercari_not_configured`)
  }

  return Response.redirect(authUrl)
}
