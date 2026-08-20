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
    if (!res.ok) return 'unreachable'
    // A 200 alone doesn't confirm the cookies actually authenticated the request --
    // an invalid/expired cookie can still land on this endpoint and get back an
    // HTML error/login page instead of a proper 401. Require the body to actually
    // parse as JSON before calling it 'valid'. Deliberately NOT asserting the exact
    // shape beyond that (e.g. requiring `data` to be an array): this is an
    // undocumented, reverse-engineered endpoint, and a wrong guess about its shape
    // would flip every genuinely valid cookie to 'invalid' -- a worse regression
    // than the "any 200 is valid" bug this replaces, since that only under-reported
    // problems rather than reporting a false one to users whose credentials work
    // fine.
    const json = await res.json().catch(() => null)
    if (json === null || typeof json !== 'object') return 'invalid'
    return 'valid'
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
  let creds: Awaited<ReturnType<typeof getEbayCreds>>
  try {
    creds = await getEbayCreds(userId)
  } catch (err) {
    // Same reasoning as checkPoshmark's getSetting guard: a settings-store
    // failure here shouldn't 500 the whole endpoint and take the Poshmark
    // status down with it via Promise.all.
    console.error('checkEbay: getEbayCreds failed', err)
    return 'unreachable'
  }
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

// ?fresh=1 was the only escape hatch from the 60s cache, which made it the only
// rate limit on live eBay OAuth mints / Poshmark probes too -- a tight client loop
// hitting ?fresh=1 bypassed the cache on every single call. Track the last fresh
// probe per user separately and only honor a repeat bypass after this interval,
// so ?fresh=1 still gets an immediate post-save refresh but can't be used to spam
// live checks.
const FRESH_BYPASS_MIN_INTERVAL_MS = 5_000
const lastFreshProbeAt = new Map<string, number>()

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // The settings UI re-requests this right after saving a credential so the
  // badge reflects the new value immediately -- ?fresh=1 bypasses the cache for
  // that one call instead of showing the pre-save status for up to 60s.
  const requestedFresh = new URL(req.url).searchParams.get('fresh') === '1'
  const now = Date.now()
  const lastFresh = lastFreshProbeAt.get(user.id) ?? 0
  const fresh = requestedFresh && now - lastFresh >= FRESH_BYPASS_MIN_INTERVAL_MS
  const cached = healthCache.get(user.id)
  if (!fresh && cached && cached.expiresAt > now) {
    return Response.json(cached.result)
  }

  if (requestedFresh) lastFreshProbeAt.set(user.id, now)
  const [poshmark, ebay] = await Promise.all([checkPoshmark(user.id), checkEbay(user.id)])
  const result = { poshmark, ebay }
  healthCache.set(user.id, { result, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS })
  return Response.json(result)
}
