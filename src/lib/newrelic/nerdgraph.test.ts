// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { parseGraphqlData, parseMutationResult, parseNerdGraphResponse } from './nerdgraph'

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

describe('parseGraphqlData', () => {
  test('returns the data object', () => {
    expect(parseGraphqlData(200, { data: { x: 1 } })).toEqual({ x: 1 })
  })

  test('throws on HTTP failure and GraphQL errors', () => {
    expect(() => parseGraphqlData(500, null)).toThrow('NerdGraph HTTP 500')
    expect(() => parseGraphqlData(200, { errors: [{ message: 'denied' }] })).toThrow('denied')
  })

  test('throws when data is missing', () => {
    expect(() => parseGraphqlData(200, {})).toThrow('NerdGraph returned no data')
  })
})

describe('parseMutationResult', () => {
  test('returns the mutation payload', () => {
    expect(parseMutationResult(200, { data: { make: { id: '7' } } }, 'make')).toEqual({ id: '7' })
  })

  test('throws when the payload is null', () => {
    expect(() => parseMutationResult(200, { data: { make: null } }, 'make')).toThrow(
      'make returned nothing',
    )
  })

  test('throws with the descriptions of payload errors', () => {
    const body = { data: { make: { errors: [{ description: 'no permission', type: 'FORBIDDEN' }] } } }
    expect(() => parseMutationResult(200, body, 'make')).toThrow('make: no permission (FORBIDDEN)')
  })

  test('throws with the description or details of a single error object', () => {
    const described = { data: { make: { error: { description: 'bad email', type: 'INVALID' } } } }
    expect(() => parseMutationResult(200, described, 'make')).toThrow('make: bad email (INVALID)')
    const detailed = { data: { make: { error: { details: 'name taken' } } } }
    expect(() => parseMutationResult(200, detailed, 'make')).toThrow('make: name taken')
  })

  test('accepts an empty errors array', () => {
    expect(parseMutationResult(200, { data: { make: { errors: [], id: '1' } } }, 'make')).toEqual({
      errors: [],
      id: '1',
    })
  })
})
