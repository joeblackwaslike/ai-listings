import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { verifyComp } from './url-verify'

// ---------------------------------------------------------------------------
// Mock helpers — node:test equivalent of vitest's vi.fn() + mockReturnValue
// ---------------------------------------------------------------------------

type MockFetch = {
  mockReturnValue: (val: unknown) => void
  mockRejectedValue: (err: unknown) => void
  mock: { calls: Array<{ arguments: unknown[] }> }
} & ((...args: unknown[]) => unknown)

function createMockFetch(): MockFetch {
  let impl: () => unknown = () => Promise.resolve(undefined)
  const fn = mock.fn((..._args: unknown[]) => impl()) as unknown as MockFetch
  fn.mockReturnValue = (val: unknown) => { impl = () => val }
  fn.mockRejectedValue = (err: unknown) => { impl = () => Promise.reject(err) }
  return fn
}

function browserlessHtmlResponse(html: string) {
  return Promise.resolve(
    new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
  )
}

let mockFetch: MockFetch
let originalFetch: typeof globalThis.fetch
let originalToken: string | undefined

beforeEach(() => {
  mockFetch = createMockFetch()
  originalFetch = globalThis.fetch
  originalToken = process.env.BROWSERLESS_TOKEN
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken !== undefined) {
    process.env.BROWSERLESS_TOKEN = originalToken
  } else {
    delete process.env.BROWSERLESS_TOKEN
  }
  mock.reset()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyComp — eBay via Browserless', () => {
  const ebayComp = {
    source: 'ebay_active',
    title: 'Louis Vuitton Neverfull MM Monogram',
    listing_url: 'https://www.ebay.com/itm/123456789',
  }

  it('returns UNCONFIRMED when BROWSERLESS_TOKEN is not set', async () => {
    const original = process.env.BROWSERLESS_TOKEN
    try {
      delete process.env.BROWSERLESS_TOKEN
      const result = await verifyComp(ebayComp, 'Louis Vuitton')
      assert.deepEqual(result, { identityConfirmed: false, soldConfirmed: false })
    } finally {
      if (original !== undefined) process.env.BROWSERLESS_TOKEN = original
    }
  })

  it('calls Browserless /content endpoint with the listing URL', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token'
    mockFetch.mockReturnValue(browserlessHtmlResponse('<html>Louis Vuitton Neverfull This listing has ended</html>'))
    await verifyComp(ebayComp, 'Louis Vuitton')
    const calls = (mockFetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls
    assert.ok(calls.length >= 1, 'fetch should have been called')
    const [url, options] = calls[0].arguments as [string, RequestInit]
    assert.equal(url, 'http://browserless.ai-listings.svc.cluster.local:3000/content')
    assert.equal((options.method ?? '').toUpperCase(), 'POST')
    const headers = options.headers as Record<string, string>
    assert.equal(headers['Authorization'], 'Bearer test-token')
  })

  it('confirms identity and sold when page contains brand, title words, and sold pattern', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token'
    mockFetch.mockReturnValue(browserlessHtmlResponse(
      '<html>Louis Vuitton Neverfull Monogram This listing has ended</html>'
    ))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.equal(result.identityConfirmed, true)
    assert.equal(result.soldConfirmed, true)
  })

  it('confirms identity but not sold when item is still active', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token'
    mockFetch.mockReturnValue(browserlessHtmlResponse(
      '<html>Louis Vuitton Neverfull Monogram Buy It Now $450</html>'
    ))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.equal(result.identityConfirmed, true)
    assert.equal(result.soldConfirmed, false)
  })

  it('returns UNCONFIRMED when Browserless fetch fails', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token'
    mockFetch.mockRejectedValue(new Error('connection refused'))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.deepEqual(result, { identityConfirmed: false, soldConfirmed: false })
  })

  it('does not call Browserless for non-eBay sources (no regression)', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token'
    // poshmark_active source — uses direct fetch path (not Browserless)
    mockFetch.mockReturnValue(browserlessHtmlResponse('<html>poshmark page</html>'))
    const comp = {
      source: 'poshmark_active',
      title: 'Louis Vuitton Bag',
      listing_url: 'https://poshmark.com/listing/abc123',
    }
    await verifyComp(comp, 'Louis Vuitton')
    const calls = (mockFetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls
    // direct fetch is called with the listing URL, not the Browserless endpoint
    const calledUrls = calls.map((c) => c.arguments[0] as string)
    assert.ok(calledUrls.some((u) => u === 'https://poshmark.com/listing/abc123'), 'should call poshmark URL directly')
    assert.ok(!calledUrls.some((u) => u.includes('browserless')), 'should NOT call browserless endpoint')
  })
})
