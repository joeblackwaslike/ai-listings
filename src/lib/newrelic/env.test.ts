// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { parseEnvFile, resolveCredentials } from './env'

describe('parseEnvFile', () => {
  test('reads KEY=value lines and ignores comments and blanks', () => {
    const parsed = parseEnvFile('# c\n\nA=1\nB=two words\n')
    expect(parsed).toEqual({ A: '1', B: 'two words' })
  })

  test('strips matching surrounding quotes and export prefix', () => {
    const parsed = parseEnvFile('export A="x y"\nB=\'z\'\n')
    expect(parsed).toEqual({ A: 'x y', B: 'z' })
  })

  test('keeps equals signs inside the value', () => {
    expect(parseEnvFile('A=b=c')).toEqual({ A: 'b=c' })
  })
})

describe('resolveCredentials', () => {
  const file = { NEW_RELIC_API_KEY: 'file-key', NEW_RELIC_ACCOUNT_ID: '123' }

  test('prefers process env over the file', () => {
    const creds = resolveCredentials({ NEW_RELIC_API_KEY: 'env-key' }, file)
    expect(creds).toEqual({ apiKey: 'env-key', accountId: 123 })
  })

  test('falls back to the file', () => {
    expect(resolveCredentials({}, file)).toEqual({ apiKey: 'file-key', accountId: 123 })
  })

  test('throws a one-line error naming the missing variable', () => {
    expect(() => resolveCredentials({}, {})).toThrow('NEW_RELIC_API_KEY not set')
    expect(() => resolveCredentials({}, { NEW_RELIC_API_KEY: 'k' })).toThrow(
      'NEW_RELIC_ACCOUNT_ID not set',
    )
  })

  test('rejects a non-integer account id', () => {
    expect(() =>
      resolveCredentials({}, { NEW_RELIC_API_KEY: 'k', NEW_RELIC_ACCOUNT_ID: '1; drop' }),
    ).toThrow('NEW_RELIC_ACCOUNT_ID must be an integer')
  })

  test('treats empty values as unset', () => {
    expect(() => resolveCredentials({ NEW_RELIC_API_KEY: '' }, {})).toThrow(
      'NEW_RELIC_API_KEY not set',
    )
  })
})
