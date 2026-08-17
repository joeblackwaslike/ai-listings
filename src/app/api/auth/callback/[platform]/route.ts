import { cookies } from 'next/headers'
import { getSetting, setSetting } from '@/lib/user-settings'
import { consumeOauthState, peekOauthState } from '@/lib/oauth-states'
import { buildProviderAuthUrl } from '@/lib/oauth-providers'
import { authLog, errorInfo } from '@/lib/auth-log'

const SUPPORTED = new Set(['imgur', 'etsy', 'ebay', 'mercari'])

function anchorCookieName(platform: string): string {
  return `oauth_anchor_${platform}`
}

export async function GET(req: Request) {
  // APP_URL is where the user's browser actually lives (napoleon-catfish.ts.net) — every
  // redirect below that's meant to land the user back in the app uses this. Nothing else on
  // this route's own domain (joeblack.nyc) is publicly routed, so it can never be a redirect
  // target itself.
  const appUrl = process.env.APP_URL!
  const settingsUrl = `${appUrl}/settings/platforms`

  const platform = new URL(req.url).pathname.split('/').at(-1)!
  if (!SUPPORTED.has(platform)) {
    return Response.redirect(`${settingsUrl}?error=unknown_platform`)
  }

  const url = new URL(req.url)
  const cookieStore = await cookies()

  // "Prepare" hop: the connect route redirects here first (still on this public domain)
  // instead of straight to the provider, so an httpOnly cookie scoped to THIS domain can be
  // set before the provider round-trip. That cookie is what lets the completion branch below
  // verify the browser completing the flow is the same one that started it — a guarantee a
  // cookie set on the app's other domain (napoleon-catfish.ts.net) can't provide, since
  // browsers never send a cookie across registrable domains.
  const prepareState = url.searchParams.get('prepare')
  if (prepareState) {
    console.log(`[oauth/${platform}] prepare hop, state=${prepareState.slice(0, 8)}…`)
    const peeked = await peekOauthState(prepareState, platform)
    if (!peeked) {
      console.warn(`[oauth/${platform}] prepare: peekOauthState found no row (missing/expired/wrong platform)`)
      return Response.redirect(`${settingsUrl}?error=invalid_state`)
    }

    const result = await buildProviderAuthUrl(platform, peeked.userId, prepareState, peeked.codeVerifier)
    if ('error' in result) {
      console.warn(`[oauth/${platform}] prepare: buildProviderAuthUrl error=${result.error}`)
      return Response.redirect(`${settingsUrl}?error=${result.error}`)
    }

    cookieStore.set(anchorCookieName(platform), prepareState, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    console.log(`[oauth/${platform}] prepare: anchor cookie set, redirecting to provider`)
    return Response.redirect(result.url)
  }

  // Completion: the provider redirects back here with `code`/`state` after the user approves.
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    console.warn(`[oauth/${platform}] completion: missing_params (code=${Boolean(code)}, state=${Boolean(state)})`)
    return Response.redirect(`${settingsUrl}?error=missing_params`)
  }

  const anchor = cookieStore.get(anchorCookieName(platform))?.value
  cookieStore.delete(anchorCookieName(platform))
  if (!anchor || anchor !== state) {
    console.warn(`[oauth/${platform}] completion: invalid_state — anchor cookie ${anchor ? 'present but mismatched' : 'missing entirely'}`)
    return Response.redirect(`${settingsUrl}?error=invalid_state`)
  }

  // No session cookie is available here either — the browser never authenticated on this
  // domain. consumeOauthState looks the user up server-side by the state param instead, and
  // single-use-deletes the row so it can't be replayed.
  const consumed = await consumeOauthState(state, platform)
  if (!consumed) {
    console.warn(`[oauth/${platform}] completion: consumeOauthState found no row (already consumed/expired)`)
    return Response.redirect(`${settingsUrl}?error=invalid_state`)
  }
  const { userId, codeVerifier } = consumed
  console.log(`[oauth/${platform}] completion: state consumed for userId=${userId}`)

  const clientId = await getSetting(userId, `${platform}_client_id`)
  if (!clientId) return Response.redirect(`${settingsUrl}?error=missing_client_id`)

  try {
    if (platform === 'imgur') {
      const clientSecret = await getSetting(userId, 'imgur_client_secret')
      if (!clientSecret) return Response.redirect(`${settingsUrl}?error=missing_client_secret`)
      const res = await fetch('https://api.imgur.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
      })
      if (!res.ok) return Response.redirect(`${settingsUrl}?error=token_exchange_failed`)
      const data = await res.json() as { access_token?: string; refresh_token?: string }
      if (!data.access_token || !data.refresh_token) return Response.redirect(`${settingsUrl}?error=no_tokens`)
      await Promise.all([
        setSetting(userId, 'imgur_access_token', data.access_token, 'credential'),
        setSetting(userId, 'imgur_refresh_token', data.refresh_token, 'credential'),
      ])

    } else if (platform === 'etsy') {
      if (!codeVerifier) return Response.redirect(`${settingsUrl}?error=missing_code_verifier`)
      // Must exactly match the redirect_uri sent in the initial authorize request
      // (buildProviderAuthUrl), which Etsy requires on the token exchange too.
      const callbackUri = `${process.env.NEXT_PUBLIC_SITE_URL!}/api/auth/callback/${platform}`
      const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: callbackUri,
          code,
          code_verifier: codeVerifier,
        }),
      })
      if (!res.ok) return Response.redirect(`${settingsUrl}?error=token_exchange_failed`)
      const data = await res.json() as { access_token?: string; refresh_token?: string }
      if (!data.access_token || !data.refresh_token) return Response.redirect(`${settingsUrl}?error=no_tokens`)
      await Promise.all([
        setSetting(userId, 'etsy_access_token', data.access_token, 'credential'),
        setSetting(userId, 'etsy_refresh_token', data.refresh_token, 'credential'),
      ])

    } else if (platform === 'ebay') {
      const clientSecret = await getSetting(userId, 'ebay_client_secret')
      const ruName = await getSetting(userId, 'ebay_ru_name')
      if (!clientSecret || !ruName) return Response.redirect(`${settingsUrl}?error=missing_credentials`)
      const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable>')
        console.error(`[oauth/ebay] token exchange failed: HTTP ${res.status} ${body}`)
        return Response.redirect(`${settingsUrl}?error=token_exchange_failed`)
      }
      const data = await res.json() as { refresh_token?: string }
      if (!data.refresh_token) return Response.redirect(`${settingsUrl}?error=no_refresh_token`)
      await setSetting(userId, 'ebay_refresh_token', data.refresh_token, 'credential')
      console.log(`[oauth/ebay] refresh token saved for userId=${userId}`)

    } else {
      return Response.redirect(`${settingsUrl}?error=not_implemented`)
    }
  } catch (err) {
    // Previously silent -- any unexpected throw during the token exchange (network failure,
    // malformed provider response, etc.) redirected to a generic error with no trace of what
    // actually happened, indistinguishable later from every other failure mode above.
    authLog.error('platform_oauth_token_exchange_unexpected_error', {
      platform,
      userId,
      error: errorInfo(err),
    })
    return Response.redirect(`${settingsUrl}?error=unexpected`)
  }

  return Response.redirect(settingsUrl)
}
