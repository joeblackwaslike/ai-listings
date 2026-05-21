import { createClient } from '@/lib/supabase/server'
import { getSetting, setSetting } from '@/lib/user-settings'
import { cookies } from 'next/headers'

const SUPPORTED = new Set(['reddit', 'imgur', 'etsy', 'ebay', 'mercari'])

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

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    return Response.redirect(`${settingsUrl}?error=missing_params`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(`oauth_state_${platform}`)?.value
  if (!storedState || storedState !== state) {
    return Response.redirect(`${settingsUrl}?error=invalid_state`)
  }
  cookieStore.delete(`oauth_state_${platform}`)

  const callbackUri = `${siteUrl}/api/auth/callback/${platform}`
  const clientId = await getSetting(user.id, `${platform}_client_id`)
  if (!clientId) return Response.redirect(`${settingsUrl}?error=missing_client_id`)

  try {
    if (platform === 'reddit') {
      const clientSecret = await getSetting(user.id, 'reddit_client_secret')
      if (!clientSecret) return Response.redirect(`${settingsUrl}?error=missing_client_secret`)
      const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ai-listings/1.0',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUri }),
      })
      if (!res.ok) return Response.redirect(`${settingsUrl}?error=token_exchange_failed`)
      const data = await res.json() as { refresh_token?: string }
      if (!data.refresh_token) return Response.redirect(`${settingsUrl}?error=no_refresh_token`)
      await setSetting(user.id, 'reddit_refresh_token', data.refresh_token, 'credential')

    } else if (platform === 'imgur') {
      const clientSecret = await getSetting(user.id, 'imgur_client_secret')
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
        setSetting(user.id, 'imgur_access_token', data.access_token, 'credential'),
        setSetting(user.id, 'imgur_refresh_token', data.refresh_token, 'credential'),
      ])

    } else if (platform === 'etsy') {
      const codeVerifier = cookieStore.get('etsy_code_verifier')?.value
      cookieStore.delete('etsy_code_verifier')
      if (!codeVerifier) return Response.redirect(`${settingsUrl}?error=missing_code_verifier`)
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
        setSetting(user.id, 'etsy_access_token', data.access_token, 'credential'),
        setSetting(user.id, 'etsy_refresh_token', data.refresh_token, 'credential'),
      ])

    } else if (platform === 'ebay') {
      const clientSecret = await getSetting(user.id, 'ebay_client_secret')
      const ruName = await getSetting(user.id, 'ebay_ru_name')
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
      if (!res.ok) return Response.redirect(`${settingsUrl}?error=token_exchange_failed`)
      const data = await res.json() as { refresh_token?: string }
      if (!data.refresh_token) return Response.redirect(`${settingsUrl}?error=no_refresh_token`)
      await setSetting(user.id, 'ebay_refresh_token', data.refresh_token, 'credential')

    } else {
      return Response.redirect(`${settingsUrl}?error=not_implemented`)
    }
  } catch {
    return Response.redirect(`${settingsUrl}?error=unexpected`)
  }

  return Response.redirect(settingsUrl)
}
