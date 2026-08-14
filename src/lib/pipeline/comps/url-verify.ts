// src/lib/pipeline/comps/url-verify.ts

// Best-effort: confirms a candidate comp's listing_url actually shows the claimed
// item, and for TheRealReal/Poshmark specifically, whether the page shows a "Sold"
// badge (reclassify as a genuine sold comp) or is still live (stays active). Any
// fetch failure or ambiguous page content leaves the comp in its default
// classification rather than blocking the pipeline on one slow/broken page.
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
  therealreal_active: /class="[^"]*sold[^"]*"|>\s*Sold\s*</i,
  poshmark_active: /"availability"\s*:\s*"sold_out"|>\s*Sold\s*</i,
}

// Only these source -> hostname pairs are ever fetched. comp.listing_url traces
// back to raw SerpAPI results with no upstream domain check, and this app runs in
// a Kubernetes cluster with real internal DNS reachable from the app namespace --
// an unrecognized source (or a URL whose host doesn't match) must never be fetched.
const ALLOWED_HOSTNAMES: Record<string, string[]> = {
  therealreal_active: ['therealreal.com', 'www.therealreal.com'],
  poshmark_active: ['poshmark.com', 'www.poshmark.com'],
}

// Sources actually eligible for verification -- present in both the sold-badge
// pattern map and the hostname allowlist, so the two lists can't silently drift
// apart if a third source is ever added to one but not the other.
const SUPPORTED_SOURCES = new Set(
  Object.keys(SOLD_BADGE_PATTERNS).filter((source) => source in ALLOWED_HOSTNAMES)
)

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const UNCONFIRMED: VerificationResult = { identityConfirmed: false, soldConfirmed: false }

function isAllowedHostname(url: string, source: string): boolean {
  const allowed = ALLOWED_HOSTNAMES[source]
  if (!allowed) return false
  try {
    return allowed.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

// Reads the response body incrementally, capping total bytes read so an arbitrary
// external page can't be fully buffered into memory. Returns null (treated as any
// other failure) if the cap is exceeded.
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

export async function verifyComp(comp: VerifiableComp, brand: string): Promise<VerificationResult> {
  if (!comp.listing_url) return UNCONFIRMED
  if (!isAllowedHostname(comp.listing_url, comp.source)) return UNCONFIRMED

  try {
    const res = await fetch(comp.listing_url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return UNCONFIRMED

    // fetch() follows redirects by default, so the final URL can differ from the
    // one requested -- re-validate against the allowlist to catch a redirect that
    // lands outside the allowed host.
    if (!isAllowedHostname(res.url, comp.source)) return UNCONFIRMED

    const html = await readBoundedText(res, MAX_RESPONSE_BYTES)
    if (html === null) return UNCONFIRMED

    const identityConfirmed = html.toLowerCase().includes(brand.toLowerCase())

    const soldPattern = SOLD_BADGE_PATTERNS[comp.source]
    const soldConfirmed = soldPattern ? soldPattern.test(html) : false

    return { identityConfirmed, soldConfirmed }
  } catch {
    return UNCONFIRMED
  }
}

// Verifies a bounded sample (not every comp -- a full fetch-every-comp pass proved
// too slow/rate-limited in early testing) and returns which indices should be
// reclassified from source X_active to a genuine sold comp.
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
  await Promise.all(
    candidates.map(async ({ c, i }) => {
      const result = await verifyComp(c, brand)
      if (result.identityConfirmed && result.soldConfirmed) reclassify.add(i)
    })
  )
  return reclassify
}
