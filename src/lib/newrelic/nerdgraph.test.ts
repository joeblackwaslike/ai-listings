// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { parseNerdGraphResponse } from './nerdgraph'

const ok = (results: unknown[]) => ({ data: { actor: { account: { nrql: { results } } } } })

describe('parseNerdGraphResponse', () => {
  test('returns the results array of a valid response', () => {
    expect(parseNerdGraphResponse(200, ok([{ a: 1 }]))).toEqual([{ a: 1 }])
  })

  test('throws the HTTP status for a non-2xx response', () => {
    expect(() => parseNerdGraphResponse(503, null)).toThrow('NerdGraph HTTP 503')
  })

  test('appends the first error message to an HTTP failure', () => {
    expect(() => parseNerdGraphResponse(401, { errors: [{ message: 'bad key' }] })).toThrow(
      'NerdGraph HTTP 401: bad key',
    )
  })

  test('throws the message of a GraphQL error', () => {
    expect(() => parseNerdGraphResponse(200, { errors: [{ message: 'syntax' }] })).toThrow('syntax')
  })

  test('throws a fixed message for an error without a message', () => {
    expect(() => parseNerdGraphResponse(200, { errors: [{}] })).toThrow(
      'NerdGraph returned an error without a message',
    )
  })

  test('throws when nrql is null', () => {
    expect(() =>
      parseNerdGraphResponse(200, { data: { actor: { account: { nrql: null } } } }),
    ).toThrow('NerdGraph returned no nrql results (check the account id)')
  })

  test('throws when data is missing', () => {
    expect(() => parseNerdGraphResponse(200, {})).toThrow(
      'NerdGraph returned no nrql results (check the account id)',
    )
  })
})
