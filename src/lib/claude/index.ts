import Anthropic from '@anthropic-ai/sdk'
import { getClaudeBackend } from './backend'
import { runStructuredApiKey, runTextApiKey } from './api-key-backend'
import { runStructuredOauth, runTextOauth } from './oauth-backend'
import type { StructuredCallParams, TextCallParams } from './types'

export type {
  ClaudeImageInput,
  StructuredCallParams,
  StructuredCallResult,
  TextCallParams,
  TextCallResult,
} from './types'
export { ClaudeStructuredOutputError } from './types'
export { getClaudeBackend } from './backend'

/**
 * The oauth backend calls the Messages API directly with the subscription token as Bearer
 * auth (see oauth-backend.ts) -- fast and cheap, but Anthropic appears to rate-limit that
 * traffic pattern separately from normal Claude Code usage (confirmed 2026-08-21: heavy
 * testing produced repeated 429 rate_limit_error responses even with substantial subscription
 * quota remaining). A 429 there doesn't mean the work is impossible, just throttled on that
 * specific path, so fall through to the api-key backend rather than surfacing the failure --
 * requires ANTHROPIC_API_KEY to have a real balance (ai-listings-2k0 follow-up).
 */
function isRateLimited(err: unknown): boolean {
  return err instanceof Anthropic.RateLimitError
}

/**
 * Public facade for every Claude call in the app. Dispatches to the
 * api-key backend (pay-per-token `@anthropic-ai/sdk`) or the oauth backend
 * (Claude subscription, direct Messages API call with Bearer auth) based on
 * `getClaudeBackend()`, falling back oauth -> api-key on a 429.
 */
export async function runStructured<T>(params: StructuredCallParams): Promise<T> {
  if (getClaudeBackend() !== 'oauth') return runStructuredApiKey<T>(params)
  try {
    return await runStructuredOauth<T>(params)
  } catch (err) {
    if (!isRateLimited(err)) throw err
    console.warn('claude: oauth backend rate-limited, falling back to api-key backend')
    return runStructuredApiKey<T>(params)
  }
}

export async function runText(params: TextCallParams): Promise<string> {
  if (getClaudeBackend() !== 'oauth') return runTextApiKey(params)
  try {
    return await runTextOauth(params)
  } catch (err) {
    if (!isRateLimited(err)) throw err
    console.warn('claude: oauth backend rate-limited, falling back to api-key backend')
    return runTextApiKey(params)
  }
}
