import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { inngest } from '@/lib/inngest/client'

const UPC_REGEX = /^\d{8,14}$/

function isPrivateUrl(url: URL): boolean {
  const h = url.hostname.toLowerCase()
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.includes('.svc.cluster') ||
    h.includes('.cluster.local')
  ) return true
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

interface UpcItem {
  title?: string
  brand?: string
  images?: string[]
}

interface UpcResponse {
  items?: UpcItem[]
}

interface ResolvedItem {
  description: string
  brand?: string
  imageUrl?: string
}

async function resolveUpc(upc: string): Promise<ResolvedItem> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error('UPC lookup failed')
    const data = (await res.json()) as UpcResponse
    const item = data.items?.[0]
    if (!item) throw new Error('No item found')
    return {
      description: item.title ?? upc,
      brand: item.brand ?? undefined,
      imageUrl: item.images?.[0] ?? undefined,
    }
  } catch {
    // Fall back to treating as free text
    return { description: upc }
  }
}

async function resolveUrl(url: string): Promise<ResolvedItem> {
  try {
    const parsed = new URL(url)
    if (isPrivateUrl(parsed)) {
      return { description: url }
    }
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ai-listings-bot/1.0)' },
    })
    if (!res.ok) throw new Error('URL fetch failed')
    const html = await res.text()

    const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)

    const title = titleMatch?.[1]
    const desc = descMatch?.[1]
    const imageUrl = imgMatch?.[1] ?? undefined

    const description = title ?? desc ?? url

    return { description, imageUrl }
  } catch {
    // Fall back to URL string as description
    return { description: url }
  }
}

async function resolveEntry(entry: string): Promise<ResolvedItem> {
  if (UPC_REGEX.test(entry)) {
    return resolveUpc(entry)
  }
  if (entry.startsWith('http://') || entry.startsWith('https://')) {
    return resolveUrl(entry)
  }
  return { description: entry }
}

interface FetchedImage {
  buffer: Buffer
  contentType: string
  ext: string
}

async function fetchImageBuffer(imageUrl: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    const ct = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
    const contentType = allowedTypes.includes(ct) ? ct : 'image/jpeg'
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    return { buffer, contentType, ext }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const supabaseAuth = await createClient()
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as { entries?: unknown }
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: 'entries must be a non-empty array' }, { status: 400 })
  }

  const entries = (body.entries as unknown[]).filter((e): e is string => typeof e === 'string')
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No valid string entries provided' }, { status: 400 })
  }
  if (entries.length > 20) {
    return NextResponse.json({ error: 'Too many entries (max 20)' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const results: Array<{ listingId: string; description: string }> = []

  for (const entry of entries) {
    const resolved = await resolveEntry(entry.trim())

    // Create listing row
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .insert({
        status: 'intake',
        pipeline_step: 0,
        pipeline_total: 4,
        user_id: user.id,
      })
      .select('id')
      .single()

    if (listingError || !listing) {
      console.error('[intake-text] Failed to create listing:', listingError)
      continue
    }

    const listingId: string = listing.id
    let uploadedImageUrl: string | undefined

    // Upload image if available
    if (resolved.imageUrl) {
      const fetched = await fetchImageBuffer(resolved.imageUrl)
      if (fetched) {
        const storagePath = `intake/${listingId}/original.${fetched.ext}`
        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(storagePath, fetched.buffer, { contentType: fetched.contentType, upsert: false })

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)
          uploadedImageUrl = urlData.publicUrl

          await supabase.from('photos').insert({
            listing_id: listingId,
            type: 'intake',
            raw_url: uploadedImageUrl,
            display_order: 0,
          })
        }
      }
    }

    // Fire Inngest event
    await inngest.send({
      name: 'text/submitted',
      data: {
        listingId,
        productData: {
          description: resolved.description,
          brand: resolved.brand,
          imageUrl: uploadedImageUrl ?? resolved.imageUrl,
        },
        uploadedAt: new Date().toISOString(),
      },
    })

    results.push({ listingId, description: resolved.description })
  }

  return NextResponse.json({ results })
}
