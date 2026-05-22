import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

const MAX_RESPONSE_BYTES = 500_000
const FETCH_TIMEOUT_MS = 10_000

function isPrivateUrl(url: URL): boolean {
  const h = url.hostname.toLowerCase()
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.includes('.svc.cluster') ||
    h.includes('.cluster.local')
  ) return true
  if (h.startsWith('[') && (
    h.startsWith('[::1]') || h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('[::ffff:')
  )) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) return true
  }
  return false
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')
  if (!platform) return Response.json({ error: 'platform query param required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('platform_rules')
    .select('rules_url, cached_at')
    .eq('user_id', user.id)
    .eq('platform', platform)
    .maybeSingle()

  return Response.json({
    rulesUrl: data?.rules_url ?? null,
    cachedAt: data?.cached_at ?? null,
  })
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { platform?: unknown; rulesUrl?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { platform, rulesUrl } = body

  if (typeof platform !== 'string' || !platform.trim()) {
    return Response.json({ error: 'platform must be a non-empty string' }, { status: 400 })
  }

  if (typeof rulesUrl !== 'string' || !rulesUrl.trim()) {
    return Response.json({ error: 'rulesUrl must be a non-empty string' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rulesUrl.trim())
  } catch {
    return Response.json({ error: 'rulesUrl must be a valid URL' }, { status: 400 })
  }

  if (parsed.protocol !== 'https:') {
    return Response.json({ error: 'rulesUrl must use https://' }, { status: 400 })
  }

  if (isPrivateUrl(parsed)) {
    return Response.json({ error: 'rulesUrl must not point to a private/internal address' }, { status: 400 })
  }

  // Fetch the page with timeout and size limit
  let plainText: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ai-listings-rules-fetcher/1.0)' },
    })
    clearTimeout(timer)

    if (!res.ok) {
      return Response.json({ error: `Failed to fetch rules page: HTTP ${res.status}` }, { status: 422 })
    }

    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const capped = bytes.length > MAX_RESPONSE_BYTES ? bytes.slice(0, MAX_RESPONSE_BYTES) : bytes
    const html = new TextDecoder().decode(capped)
    plainText = stripHtml(html).slice(0, 8000)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return Response.json({ error: 'Timed out fetching rules page' }, { status: 422 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[platform-rules] fetch failed:', msg)
    return Response.json({ error: `Failed to fetch rules page: ${msg}` }, { status: 422 })
  }

  const admin = getSupabaseAdmin()
  const cachedAt = new Date().toISOString()

  const { error: upsertError } = await admin
    .from('platform_rules')
    .upsert(
      {
        user_id: user.id,
        platform: platform.trim(),
        rules_url: rulesUrl.trim(),
        rules_cache: plainText,
        cached_at: cachedAt,
      },
      { onConflict: 'user_id,platform' }
    )

  if (upsertError) {
    console.error('platform_rules upsert failed:', upsertError)
    return Response.json({ error: 'Failed to save rules' }, { status: 500 })
  }

  return Response.json({ ok: true, cachedAt, previewLength: plainText.length })
}
