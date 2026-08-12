import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPostToEbayError } from '@/lib/platforms/post-to-ebay-error'
import { AuthExpiredError, PlatformError, NotFoundError, UnsupportedOperationError } from '@/lib/platforms/errors'

test('mapPostToEbayError maps AuthExpiredError to 401 with a reconnect message', () => {
  const result = mapPostToEbayError(new AuthExpiredError('ebay'))
  assert.equal(result.status, 401)
  assert.match(result.error, /reconnect your eBay account/)
})

test('mapPostToEbayError maps a generic PlatformError to 422 and surfaces its message verbatim', () => {
  const err = new PlatformError('ebay', 'Category ID 9355 is invalid for this marketplace')
  const result = mapPostToEbayError(err)
  assert.equal(result.status, 422)
  assert.equal(result.error, err.message)
})

test('mapPostToEbayError maps PlatformError subclasses (e.g. NotFoundError) to 422, not 401', () => {
  // AuthExpiredError must be checked before the generic PlatformError branch since it is a
  // subclass — this guards against an ordering regression that would misroute every
  // PlatformError subclass through the 401 branch (or vice versa).
  const result = mapPostToEbayError(new NotFoundError('ebay', 'offer'))
  assert.equal(result.status, 422)
})

test('mapPostToEbayError maps UnsupportedOperationError (also a PlatformError subclass) to 422', () => {
  const result = mapPostToEbayError(new UnsupportedOperationError('ebay', 'createListing'))
  assert.equal(result.status, 422)
})

test('mapPostToEbayError maps an unrelated error to 500 with a generic message', () => {
  const result = mapPostToEbayError(new Error('ECONNRESET'))
  assert.equal(result.status, 500)
  assert.equal(result.error, 'Failed to post listing to eBay')
})

test('mapPostToEbayError maps a non-Error thrown value to 500', () => {
  const result = mapPostToEbayError('some string throw')
  assert.equal(result.status, 500)
})
