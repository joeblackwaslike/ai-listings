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

function htmlResponse(html: string) {
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
  originalToken = process.env.STEALTH_BROWSER_TOKEN
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken !== undefined) {
    process.env.STEALTH_BROWSER_TOKEN = originalToken
  } else {
    delete process.env.STEALTH_BROWSER_TOKEN
  }
  mock.reset()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyComp — eBay via the stealth-browser gateway', () => {
  const ebayComp = {
    source: 'ebay_active',
    title: 'Louis Vuitton Neverfull MM Monogram',
    listing_url: 'https://www.ebay.com/itm/123456789',
  }

  it('returns UNCONFIRMED and warns once when STEALTH_BROWSER_TOKEN is not set', async () => {
    const warn = mock.method(console, 'warn', () => {})
    delete process.env.STEALTH_BROWSER_TOKEN
    const first = await verifyComp(ebayComp, 'Louis Vuitton')
    const second = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.deepEqual(first, { identityConfirmed: false, soldConfirmed: false })
    assert.deepEqual(second, { identityConfirmed: false, soldConfirmed: false })
    const tokenWarnings = warn.mock.calls.filter((c) => String(c.arguments[0]).includes('STEALTH_BROWSER_TOKEN'))
    assert.equal(tokenWarnings.length, 1)
  })

  it('cancels the response body when the gateway answers non-OK', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    mock.method(console, 'warn', () => {})
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    mockFetch.mockReturnValue(Promise.resolve(new Response(body, { status: 423 })))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.deepEqual(result, { identityConfirmed: false, soldConfirmed: false })
    assert.equal(cancelled, true)
  })

  it('calls the gateway /content endpoint with the listing URL', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    mockFetch.mockReturnValue(htmlResponse('<html>Louis Vuitton Neverfull This listing has ended</html>'))
    await verifyComp(ebayComp, 'Louis Vuitton')
    const calls = (mockFetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls
    assert.ok(calls.length >= 1, 'fetch should have been called')
    const [url, options] = calls[0].arguments as [string, RequestInit]
    assert.equal(url, 'http://gateway.stealth-browser.svc.cluster.local:8080/content')
    assert.equal((options.method ?? '').toUpperCase(), 'POST')
    const headers = options.headers as Record<string, string>
    assert.equal(headers['Authorization'], 'Bearer test-token')
  })

  it('confirms identity and sold when page contains brand, title words, and sold pattern', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    mockFetch.mockReturnValue(htmlResponse(
      '<html>Louis Vuitton Neverfull Monogram This listing has ended</html>'
    ))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.equal(result.identityConfirmed, true)
    assert.equal(result.soldConfirmed, true)
  })

  it('confirms identity but not sold when item is still active', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    mockFetch.mockReturnValue(htmlResponse(
      '<html>Louis Vuitton Neverfull Monogram Buy It Now $450</html>'
    ))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.equal(result.identityConfirmed, true)
    assert.equal(result.soldConfirmed, false)
  })

  it('returns UNCONFIRMED when the gateway fetch fails', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    mockFetch.mockRejectedValue(new Error('connection refused'))
    const result = await verifyComp(ebayComp, 'Louis Vuitton')
    assert.deepEqual(result, { identityConfirmed: false, soldConfirmed: false })
  })

  it('does not call the gateway for non-eBay sources (no regression)', async () => {
    process.env.STEALTH_BROWSER_TOKEN = 'test-token'
    // poshmark_active source — uses direct fetch path (not the gateway)
    mockFetch.mockReturnValue(htmlResponse('<html>poshmark page</html>'))
    const comp = {
      source: 'poshmark_active',
      title: 'Louis Vuitton Bag',
      listing_url: 'https://poshmark.com/listing/abc123',
    }
    await verifyComp(comp, 'Louis Vuitton')
    const calls = (mockFetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls
    // direct fetch is called with the listing URL, not the gateway endpoint
    const calledUrls = calls.map((c) => c.arguments[0] as string)
    assert.ok(calledUrls.some((u) => u === 'https://poshmark.com/listing/abc123'), 'should call poshmark URL directly')
    assert.ok(!calledUrls.some((u) => u.includes('stealth-browser')), 'should NOT call the gateway endpoint')
  })

  it('cancels the response body when a direct fetch answers non-OK', async () => {
    mock.method(console, 'warn', () => {})
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    mockFetch.mockReturnValue(Promise.resolve(new Response(body, { status: 403 })))
    const comp = {
      source: 'poshmark_active',
      title: 'Louis Vuitton Bag',
      listing_url: 'https://poshmark.com/listing/abc123',
    }
    await verifyComp(comp, 'Louis Vuitton')
    assert.equal(cancelled, true)
  })
})
