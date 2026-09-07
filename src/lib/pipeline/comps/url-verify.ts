// src/lib/pipeline/comps/url-verify.ts

export interface VerifiableComp {
  source: string
  title: string
  listing_url: string
}

export interface VerificationResult {
  identityConfirmed: boolean
  soldConfirmed: boolean
}

const SOLD_BADGE_PATTERNS: Record<string, RegExp> = {
  therealreal_active: /class="[^"]*\bsold\b[^"]*"|>\s*Sold\s*<\/[a-z]/i,
  poshmark_active: /"availability"\s*:\s*"sold_out"|>\s*Sold\s*<\/[a-z]/i,
  ebay_sold: /this listing has ended|"availability"\s*:\s*"SOLD"|>\s*Sold\s*<\/[a-z]/i,
  ebay: /this listing has ended|"availability"\s*:\s*"SOLD"|>\s*Sold\s*<\/[a-z]/i,
}

const ALLOWED_HOSTNAMES: Record<string, string[]> = {
  therealreal_active: ['therealreal.com', 'www.therealreal.com'],
  poshmark_active: ['poshmark.com', 'www.poshmark.com'],
  ebay_sold: ['ebay.com', 'www.ebay.com'],
  ebay: ['ebay.com', 'www.ebay.com'],
}

// Sources whose URLs require a headless browser (direct fetch is bot-blocked).
// Fetched via the internal Browserless service instead of raw fetch().
const BROWSERLESS_HOSTNAMES = new Set(['ebay.com', 'www.ebay.com'])

const BROWSERLESS_URL = 'http://browserless.ai-listings.svc.cluster.local:3000/content'

const SUPPORTED_SOURCES = new Set(
  Object.keys(SOLD_BADGE_PATTERNS).filter((source) => source in ALLOWED_HOSTNAMES)
)

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const UNCONFIRMED: VerificationResult = { identityConfirmed: false, soldConfirmed: false }

const TITLE_WORD_STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'from', 'this', 'that', 'your', 'new', 'used', 'size',
])

function significantTitleWords(title: string, brand: string): string[] {
  const brandWords = new Set(brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !TITLE_WORD_STOPWORDS.has(w) && !brandWords.has(w))
}

function isAllowedHostname(url: string, source: string): boolean {
  const allowed = ALLOWED_HOSTNAMES[source]
  if (!allowed) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return allowed.includes(parsed.hostname)
  } catch {
    return false
  }
}

async function readBoundedText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        if (received > maxBytes) {
          await reader.cancel()
          return null
        }
        text += decoder.decode(value, { stream: true })
      }
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

// Fetches a URL via the internal Browserless service (real Chromium render).
// Returns null on any failure — caller treats null as UNCONFIRMED.
async function fetchViaBrowserless(url: string): Promise<string | null> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return null

  try {
    const res = await fetch(BROWSERLESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url, waitForTimeout: 3000 }),
      signal: AbortSignal.timeout(35_000),
    })
    if (!res.ok) {
      console.warn(`fetchViaBrowserless: HTTP ${res.status} for ${url}`)
      return null
    }
    return await readBoundedText(res, MAX_RESPONSE_BYTES)
  } catch (err) {
    console.warn('fetchViaBrowserless: failed for', url, err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function verifyComp(comp: VerifiableComp, brand: string): Promise<VerificationResult> {
  if (!comp.listing_url) return UNCONFIRMED
  if (!isAllowedHostname(comp.listing_url, comp.source)) return UNCONFIRMED

  try {
    let html: string | null

    const hostname = (() => {
      try { return new URL(comp.listing_url).hostname } catch { return '' }
    })()

    if (BROWSERLESS_HOSTNAMES.has(hostname)) {
      html = await fetchViaBrowserless(comp.listing_url)
    } else {
      const res = await fetch(comp.listing_url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      })
      if (!res.ok) {
        console.warn(`verifyComp: HTTP ${res.status} for ${comp.listing_url}`)
        return UNCONFIRMED
      }
      if (!isAllowedHostname(res.url, comp.source)) return UNCONFIRMED
      html = await readBoundedText(res, MAX_RESPONSE_BYTES)
    }

    if (html === null) {
      console.warn(`verifyComp: no HTML for ${comp.listing_url}`)
      return UNCONFIRMED
    }

    const htmlLower = html.toLowerCase()
    const brandConfirmed = htmlLower.includes(brand.toLowerCase())
    const otherTitleWords = significantTitleWords(comp.title, brand)
    const identityConfirmed =
      brandConfirmed && (otherTitleWords.length === 0 || otherTitleWords.some((w) => htmlLower.includes(w)))

    const soldPattern = SOLD_BADGE_PATTERNS[comp.source]
    const soldConfirmed = soldPattern ? soldPattern.test(html) : false

    return { identityConfirmed, soldConfirmed }
  } catch (err) {
    console.warn('verifyComp: failed for', comp.listing_url, err instanceof Error ? err.message : String(err))
    return UNCONFIRMED
  }
}

const VERIFY_CONCURRENCY = 3

export async function verifyAndReclassify<T extends VerifiableComp & { sold_at: string | null }>(
  comps: T[],
  brand: string,
  sampleSize = 10
): Promise<Set<number>> {
  const candidates = comps
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => SUPPORTED_SOURCES.has(c.source))
    .slice(0, sampleSize)

  const reclassify = new Set<number>()
  for (let start = 0; start < candidates.length; start += VERIFY_CONCURRENCY) {
    const batch = candidates.slice(start, start + VERIFY_CONCURRENCY)
    await Promise.all(
      batch.map(async ({ c, i }) => {
        const result = await verifyComp(c, brand)
        if (result.identityConfirmed && result.soldConfirmed) reclassify.add(i)
      })
    )
  }
  return reclassify
}
