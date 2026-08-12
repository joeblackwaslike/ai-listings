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
 * Public facade for every Claude call in the app. Dispatches to the
 * api-key backend (pay-per-token `@anthropic-ai/sdk`) or the oauth backend
 * (Claude subscription via `@anthropic-ai/claude-agent-sdk`, currently
 * unverified — see `oauth-backend.ts`) based on `getClaudeBackend()`.
 */
export async function runStructured<T>(params: StructuredCallParams): Promise<T> {
  return getClaudeBackend() === 'oauth' ? runStructuredOauth<T>(params) : runStructuredApiKey<T>(params)
}

export async function runText(params: TextCallParams): Promise<string> {
  return getClaudeBackend() === 'oauth' ? runTextOauth(params) : runTextApiKey(params)
}
