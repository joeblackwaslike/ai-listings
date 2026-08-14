import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { EBAY_SCOPE_BASE } from '@/lib/pipeline/comps/ebay-oauth'

type HealthStatus = 'valid' | 'invalid' | 'unreachable' | 'not_configured'

async function checkPoshmark(userId: string): Promise<HealthStatus> {
  try {
    const cookies = await getSetting(userId, 'poshmark_cookies')
    if (!cookies) return 'not_configured'
    if (!cookies.includes('=') || !cookies.includes(';')) return 'invalid'
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

async function checkEbay(): Promise<HealthStatus> {
  const id = process.env.EBAY_CLIENT_ID
  const secret = process.env.EBAY_CLIENT_SECRET
  if (!id || !secret) return 'not_configured'
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString('base64')
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE_BASE)}`,
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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [poshmark, ebay] = await Promise.all([checkPoshmark(user.id), checkEbay()])
  return Response.json({ poshmark, ebay })
}
