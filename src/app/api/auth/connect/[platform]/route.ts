import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { createOauthState } from '@/lib/oauth-states'
import { randomBytes } from 'crypto'

const SUPPORTED = new Set(['imgur', 'etsy', 'ebay', 'mercari'])

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // NEXT_PUBLIC_SITE_URL is the narrow public-only domain (joeblack.nyc) — it's ONLY valid
  // for constructing URLs that must match what's registered with each platform's OAuth app,
  // or for handing off to the public "prepare" hop below. It must never be used as a redirect
  // target for the user's browser otherwise: its public ingress only routes
  // /api/auth/callback/*, so anything else 404s.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!
  // APP_URL is where the user's browser actually lives (napoleon-catfish.ts.net) — use this
  // for every redirect meant to land the user back in the app.
  const appUrl = process.env.APP_URL!
  const settingsUrl = `${appUrl}/settings/platforms`

  if (!user) {
    console.warn('[oauth/connect] no session on APP_URL — redirecting to login')
    return Response.redirect(`${appUrl}/login`)
  }

  const platform = new URL(req.url).pathname.split('/').at(-1)!
  if (!SUPPORTED.has(platform)) {
    return Response.redirect(`${settingsUrl}?error=unknown_platform`)
  }

  const clientId = await getSetting(user.id, `${platform}_client_id`)
  if (!clientId) {
    console.warn(`[oauth/connect/${platform}] missing_client_id for userId=${user.id}`)
    return Response.redirect(`${settingsUrl}?error=missing_client_id`)
  }

  const codeVerifier = platform === 'etsy' ? randomBytes(32).toString('base64url') : undefined
  const state = await createOauthState(user.id, platform, codeVerifier)
  console.log(`[oauth/connect/${platform}] state created for userId=${user.id}, handing off to prepare hop`)

  // Hand off to the public "prepare" hop (joeblack.nyc, same route as the eventual callback —
  // see src/app/api/auth/callback/[platform]/route.ts) instead of redirecting straight to the
  // provider. That hop sets a domain-scoped anchor cookie binding this state to the browser
  // before redirecting on, which restores the "only the browser that started this can finish
  // it" CSRF guarantee a cross-domain cookie set here couldn't provide directly (the browser
  // never carries a napoleon-catfish.ts.net cookie back to a joeblack.nyc request).
  return Response.redirect(`${siteUrl}/api/auth/callback/${platform}?prepare=${state}`)
}
