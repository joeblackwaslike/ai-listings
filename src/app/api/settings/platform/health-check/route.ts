import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { getEbayCreds } from '@/lib/platforms/credentials'

type HealthStatus = 'valid' | 'invalid' | 'unreachable' | 'not_configured'

async function checkPoshmark(userId: string): Promise<HealthStatus> {
  let cookies: string | null
  try {
    cookies = await getSetting(userId, 'poshmark_cookies')
  } catch (err) {
    // Distinguish "our own settings lookup failed" (e.g. Supabase down) from a
    // genuine Poshmark connectivity problem below -- both surface as 'unreachable'
    // to the UI today, but this is at least visible in server logs.
    console.error('checkPoshmark: getSetting failed', err)
    return 'unreachable'
  }
  if (!cookies) return 'not_configured'
  if (!cookies.includes('=') || !cookies.includes(';')) return 'invalid'
  try {
    const params = new URLSearchParams({
      app_version: '2.55', count: '1', max_id: '0', q: 'test',
      sort_by: 'best_match', availability: 'available', summarize: 'true', _: Date.now().toString(),
    })
    const res = await fetch(`https://poshmark.com/vm-rest/posts?${params}`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) return 'invalid'
    if (res.ok) return 'valid'
    return 'unreachable'
  } catch {
    return 'unreachable'
  }
}

// Validates the *user's own* eBay connection (client id/secret/refresh token
// saved in their platform settings, the same credentials EbayAdapter uses to
// list/manage orders) -- not the deployment-wide EBAY_CLIENT_ID/SECRET, which
// is a separate app-level credential used only by the pricing pipeline's
// comps search (src/lib/pipeline/comps/ebay-oauth.ts) and says nothing about
// whether this user has connected their own eBay seller account.
async function checkEbay(userId: string): Promise<HealthStatus> {
  const creds = await getEbayCreds(userId)
  if (!creds) return 'not_configured'
  try {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
    // No `scope` param: per RFC 6749 §6, omitting it on a refresh_token grant
    // returns a token with the same scope(s) originally granted during the
    // user's OAuth consent, which we don't know here and shouldn't guess at.
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refreshToken)}`,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 400) return 'invalid'
    if (!res.ok) return 'unreachable'
    const json = (await res.json()) as { access_token?: string }
    return json.access_token ? 'valid' : 'invalid'
  } catch {
    return 'unreachable'
  }
}

// Both checks below make live outbound requests (Poshmark REST + an eBay OAuth
// token mint) with no client-side control over call frequency -- a short-lived
// server-side cache keeps repeat page loads/mounts from hammering either
// platform's rate limits or eBay's per-client token-mint quota.
const HEALTH_CACHE_TTL_MS = 60_000
const healthCache = new Map<string, { result: { poshmark: HealthStatus; ebay: HealthStatus }; expiresAt: number }>()

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const cached = healthCache.get(user.id)
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.result)
  }

  const [poshmark, ebay] = await Promise.all([checkPoshmark(user.id), checkEbay(user.id)])
  const result = { poshmark, ebay }
  healthCache.set(user.id, { result, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS })
  return Response.json(result)
}
