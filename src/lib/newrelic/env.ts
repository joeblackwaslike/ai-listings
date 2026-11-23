export interface Credentials {
  apiKey: string
  accountId: number
}

type EnvMap = Record<string, string | undefined>

export function parseEnvFile(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    parsed[key] = quoted ? quoted[2] : value
  }
  return parsed
}

export function envFileNeeded(env: EnvMap): boolean {
  return !env.NEW_RELIC_API_KEY || !env.NEW_RELIC_ACCOUNT_ID
}

function pick(name: string, env: EnvMap, file: EnvMap): string {
  const value = env[name] || file[name]
  if (!value) throw new Error(`${name} not set`)
  return value
}

export function resolveCredentials(env: EnvMap, file: EnvMap): Credentials {
  const apiKey = pick('NEW_RELIC_API_KEY', env, file)
  const rawAccountId = pick('NEW_RELIC_ACCOUNT_ID', env, file)
  if (!/^\d+$/.test(rawAccountId)) throw new Error('NEW_RELIC_ACCOUNT_ID must be an integer')
  return { apiKey, accountId: Number(rawAccountId) }
}
