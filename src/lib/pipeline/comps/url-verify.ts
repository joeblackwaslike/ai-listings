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
  // Word-bounded so a class/token that merely contains "sold" as a substring
  // (e.g. "resold", "unsold", "sold_count") doesn't falsely flag an active
  // listing as sold.
  therealreal_active: /class="[^"]*\bsold\b[^"]*"|>\s*Sold\s*<\/[a-z]/i,
  poshmark_active: /"availability"\s*:\s*"sold_out"|>\s*Sold\s*<\/[a-z]/i,
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

const TITLE_WORD_STOPWORDS = new Set([
  'and', 'the', 'with', 'for', 'from', 'this', 'that', 'your', 'new', 'used', 'size',
])

// Words worth checking for on the fetched page beyond the brand name itself --
// short/common words are too likely to appear by coincidence to mean anything.
// Brand words are excluded token-by-token (not by comparing the whole title word
// against the whole brand string) so a multi-word brand like "Louis Vuitton"
// doesn't leave "louis" and "vuitton" behind as if they were independent
// title-specific signal -- both would trivially be found on the page once the
// brand itself has already matched, making the whole check a no-op.
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
      // The allowlist above only validates the *requested* URL -- fetch() follows
      // redirects by default, and a redirect chain (attacker-influenced, since
      // listing_url traces back to raw SerpAPI results) could land on an internal
      // address (e.g. cloud metadata) before any post-fetch hostname check runs.
      // 'error' is documented to reject the fetch outright on any redirect, though
      // that's not guaranteed identical across every fetch implementation -- some
      // runtimes could plausibly resolve with an opaque error response instead of
      // throwing. Either way this is safe: a thrown error is caught below and
      // returns UNCONFIRMED, and an opaque response fails the res.ok check next.
      redirect: 'error',
    })
    if (!res.ok) {
      // Distinct from the catch-all below: this is a clean HTTP response, just not
      // a 2xx (e.g. a 403 bot challenge from TheRealReal/Poshmark) -- worth telling
      // apart from a network-level failure if reclassification quietly stops working.
      console.warn(`verifyComp: HTTP ${res.status} for ${comp.listing_url}`)
      return UNCONFIRMED
    }

    // Defense in depth: with redirect: 'error' behaving as documented, res.url here
    // always equals the originally-validated URL and this check can never actually
    // catch anything -- it's kept in case a runtime's fetch resolves a redirect
    // (opaque error response) rather than throwing, which would otherwise reach
    // this point with res.url pointing past the allowlist.
    if (!isAllowedHostname(res.url, comp.source)) return UNCONFIRMED

    const html = await readBoundedText(res, MAX_RESPONSE_BYTES)
    if (html === null) {
      console.warn(`verifyComp: response exceeded ${MAX_RESPONSE_BYTES} bytes for ${comp.listing_url}`)
      return UNCONFIRMED
    }

    // Brand-only matching lets an unrelated same-brand listing (wrong model/color)
    // satisfy identity, which would then let a *different* item's sold badge
    // reclassify this comp -- also require at least one other significant word
    // from the comp's own title to appear on the page. otherTitleWords can be
    // empty for more than just a single-word title (e.g. "Chanel" alone) -- any
    // title whose non-brand words are all short (<4 chars) or in the stopword
    // list (e.g. "Nike Air") lands here too. Either way, fall back to the
    // brand-only check rather than making identity unconfirmable altogether.
    const htmlLower = html.toLowerCase()
    const brandConfirmed = htmlLower.includes(brand.toLowerCase())
    const otherTitleWords = significantTitleWords(comp.title, brand)
    const identityConfirmed =
      brandConfirmed && (otherTitleWords.length === 0 || otherTitleWords.some((w) => htmlLower.includes(w)))

    const soldPattern = SOLD_BADGE_PATTERNS[comp.source]
    const soldConfirmed = soldPattern ? soldPattern.test(html) : false

    return { identityConfirmed, soldConfirmed }
  } catch (err) {
    // Best-effort: any failure (network, timeout, redirect, malformed response,
    // or a genuine programming error) leaves the comp in its default
    // classification. Log so a real bug here doesn't look identical to a
    // routine network timeout in production.
    console.warn('verifyComp: failed for', comp.listing_url, err instanceof Error ? err.message : String(err))
    return UNCONFIRMED
  }
}

// Fetching every candidate at once (up to `sampleSize` concurrent outbound
// requests to the same external host) risks tripping rate-limiting/bot-detection
// on TheRealReal or Poshmark. Verification runs at pipeline time, where
// throughput isn't critical, so a small batch size trades a little latency for
// being a better-behaved client.
const VERIFY_CONCURRENCY = 3

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
