// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { envFileNeeded, parseEnvFile, resolveCredentials } from './env'

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

describe('parseEnvFile edge cases', () => {
  test('trims CRLF line endings', () => {
    expect(parseEnvFile('NEW_RELIC_API_KEY=abc\r\nB=1\r\n')).toEqual({
      NEW_RELIC_API_KEY: 'abc',
      B: '1',
    })
  })

  test('skips a line without an equals sign and a line starting with one', () => {
    expect(parseEnvFile('NOEQUALS\n=orphan\nA=1')).toEqual({ A: '1' })
  })
})

describe('envFileNeeded', () => {
  test('is false when both variables are in the environment', () => {
    expect(envFileNeeded({ NEW_RELIC_API_KEY: 'k', NEW_RELIC_ACCOUNT_ID: '1' })).toBe(false)
  })

  test('is true when either variable is missing or empty', () => {
    expect(envFileNeeded({ NEW_RELIC_API_KEY: 'k' })).toBe(true)
    expect(envFileNeeded({ NEW_RELIC_API_KEY: '', NEW_RELIC_ACCOUNT_ID: '1' })).toBe(true)
  })
})

describe('resolveCredentials', () => {
  const file = { NEW_RELIC_API_KEY: 'file-key', NEW_RELIC_ACCOUNT_ID: '123' }

  test('prefers process env over the file', () => {
    const creds = resolveCredentials({ NEW_RELIC_API_KEY: 'env-key' }, file)
    expect(creds).toEqual({ apiKey: 'env-key', accountId: 123 })
  })

  test('prefers an env account id over the file one', () => {
    const creds = resolveCredentials({ NEW_RELIC_ACCOUNT_ID: '999' }, file)
    expect(creds).toEqual({ apiKey: 'file-key', accountId: 999 })
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
