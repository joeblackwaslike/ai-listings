import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapItemSpecificsToAspects, EbayAdapter } from './ebay'

test('mapItemSpecificsToAspects wraps each flat value in a single-element array', () => {
  const result = mapItemSpecificsToAspects({ Brand: 'Coach', Material: 'Leather' })
  assert.deepEqual(result, { Brand: ['Coach'], Material: ['Leather'] })
})

test('mapItemSpecificsToAspects drops empty-string values', () => {
  const result = mapItemSpecificsToAspects({ Brand: 'Coach', Color: '' })
  assert.deepEqual(result, { Brand: ['Coach'] })
})

test('mapItemSpecificsToAspects returns {} for undefined input', () => {
  assert.deepEqual(mapItemSpecificsToAspects(undefined), {})
})

test('mapItemSpecificsToAspects returns {} for an empty object', () => {
  assert.deepEqual(mapItemSpecificsToAspects({}), {})
})

// Status filter mapping tests
test('getMyListings converts internal status "active" to eBay "PUBLISHED"', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  let capturedUrl = ''

  // Mock getAccessToken
  adapter.getAccessToken = async () => 'test-token'

  // Mock ebayFetch to capture URL and return test data
  adapter.ebayFetch = async (url: string) => {
    capturedUrl = url
    return { offers: [] }
  }

  await adapter.getMyListings({ status: 'active' })
  assert.match(capturedUrl, /status=PUBLISHED/, 'should map "active" to "PUBLISHED"')
})

test('getMyListings converts internal status "draft" to eBay "UNPUBLISHED"', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  let capturedUrl = ''

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async (url: string) => {
    capturedUrl = url
    return { offers: [] }
  }

  await adapter.getMyListings({ status: 'draft' })
  assert.match(capturedUrl, /status=UNPUBLISHED/, 'should map "draft" to "UNPUBLISHED"')
})

test('getMyListings converts internal status "sold" to eBay "ENDED"', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  let capturedUrl = ''

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async (url: string) => {
    capturedUrl = url
    return { offers: [] }
  }

  await adapter.getMyListings({ status: 'sold' })
  assert.match(capturedUrl, /status=ENDED/, 'should map "sold" to "ENDED"')
})

// Cursor pagination tests
test('getMyListings paginates through multiple pages using next URL', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  let callCount = 0
  const capturedUrls: string[] = []

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async (url: string) => {
    capturedUrls.push(url)
    callCount++

    if (callCount === 1) {
      return {
        offers: [{ listingId: 'item1', status: 'PUBLISHED', pricingSummary: { price: { value: '10.00' } } }],
        next: 'https://api.ebay.com/sell/inventory/v1/offer?offset=100',
      }
    } else if (callCount === 2) {
      return {
        offers: [{ listingId: 'item2', status: 'PUBLISHED', pricingSummary: { price: { value: '20.00' } } }],
      }
    }
    return { offers: [] }
  }

  const listings = await adapter.getMyListings()
  assert.equal(callCount, 2, 'should make 2 API calls')
  assert.equal(listings.length, 2, 'should return listings from both pages')
  assert.equal(listings[0].platformId, 'item1', 'first listing should be from first page')
  assert.equal(listings[1].platformId, 'item2', 'second listing should be from second page')
})

test('getOrders paginates through multiple pages using next URL', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  let callCount = 0

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async (url: string) => {
    callCount++

    if (callCount === 1) {
      return {
        orders: [
          {
            orderId: 'order1',
            creationDate: new Date().toISOString(),
            orderFulfillmentStatus: 'FULFILLED',
          },
        ],
        next: 'https://api.ebay.com/sell/fulfillment/v1/order?offset=50',
      }
    } else if (callCount === 2) {
      return {
        orders: [
          {
            orderId: 'order2',
            creationDate: new Date().toISOString(),
            orderFulfillmentStatus: 'FULFILLED',
          },
        ],
      }
    }
    return { orders: [] }
  }

  const orders = await adapter.getOrders()
  assert.equal(callCount, 2, 'should make 2 API calls')
  assert.equal(orders.length, 2, 'should return orders from both pages')
})

// Status mapping from eBay to internal
test('getMyListings maps eBay "PUBLISHED" status to internal "active" status', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async () => ({
    offers: [{ listingId: 'item1', status: 'PUBLISHED', pricingSummary: { price: { value: '10.00' } } }],
  })

  const listings = await adapter.getMyListings()
  assert.equal(listings[0].status, 'active', 'should map PUBLISHED to active')
})

test('getMyListings maps eBay "ENDED" status to internal "sold" status', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async () => ({
    offers: [{ listingId: 'item1', status: 'ENDED', pricingSummary: { price: { value: '10.00' } } }],
  })

  const listings = await adapter.getMyListings()
  assert.equal(listings[0].status, 'sold', 'should map ENDED to sold')
})

test('getMyListings maps eBay "UNPUBLISHED" status to internal "draft" status', async () => {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })

  adapter.getAccessToken = async () => 'test-token'
  adapter.ebayFetch = async () => ({
    offers: [{ listingId: 'item1', status: 'UNPUBLISHED', pricingSummary: { price: { value: '10.00' } } }],
  })

  const listings = await adapter.getMyListings()
  assert.equal(listings[0].status, 'draft', 'should map UNPUBLISHED to draft')
})
