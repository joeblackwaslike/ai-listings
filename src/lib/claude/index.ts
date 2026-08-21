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

function logFallback(err: unknown): void {
  console.warn(
    'claude: api-key backend failed, falling back to oauth (subscription) backend:',
    err instanceof Error ? err.message : err
  )
}

/**
 * Public facade for every Claude call in the app. Always tries the pay-per-token api-key
 * backend first -- it's a plain HTTPS call (~1-3s), no subprocess, no per-call system-prompt
 * reload. Falls back to the subscription (oauth) backend, which spawns a real `claude` CLI
 * subprocess per call (own process, full Claude Code system-prompt reload, ~30s-2min/call --
 * see oauth-backend.ts), only when the api-key call fails and a subscription token is
 * configured. Direct Bearer-token calls against the subscription token were tried instead of
 * the subprocess (faster, cheaper) but got throttled hard as automated/server-side traffic
 * even with plenty of subscription quota remaining -- the subprocess path doesn't hit that
 * wall since it's genuine Claude Code CLI traffic (ai-listings-2k0). Net effect: once
 * ANTHROPIC_API_KEY has a real balance, oauth is never invoked; until then, every call pays
 * one fast, cheap failed attempt before falling through.
 */
export async function runStructured<T>(params: StructuredCallParams): Promise<T> {
  try {
    return await runStructuredApiKey<T>(params)
  } catch (err) {
    if (getClaudeBackend() !== 'oauth') throw err
    logFallback(err)
    return runStructuredOauth<T>(params)
  }
}

export async function runText(params: TextCallParams): Promise<string> {
  try {
    return await runTextApiKey(params)
  } catch (err) {
    if (getClaudeBackend() !== 'oauth') throw err
    logFallback(err)
    return runTextOauth(params)
  }
}
