// Structured, greppable logging for everything auth-related (proxy session checks, the
// sign-in callback, and the Server-Component cookie-write gap in supabase/server.ts).
// Plain console.log/warn/error with a JSON payload, matching this codebase's existing
// bracketed-tag console logging convention (see confirm-gender/route.ts etc.) but structured
// so it can be jq-filtered the same way the self-hosted GoTrue logs already are, e.g.:
//   kubectl logs -n ai-listings -l app=ai-listings | grep '\[auth\]' | sed 's/.*\[auth\] //' | jq
//
// Never log actual cookie/token VALUES -- only names, counts, and byte lengths. A cookie
// name and size is enough to diagnose persistence/chunking issues without leaking a session.

type AuthLogData = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', event: string, data: AuthLogData) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data })
  if (level === 'error') console.error('[auth]', line)
  else if (level === 'warn') console.warn('[auth]', line)
  else console.log('[auth]', line)
}

export const authLog = {
  info: (event: string, data: AuthLogData = {}) => emit('info', event, data),
  warn: (event: string, data: AuthLogData = {}) => emit('warn', event, data),
  error: (event: string, data: AuthLogData = {}) => emit('error', event, data),
}

export interface CookieLike {
  name: string
  value: string
}

// Summarizes a cookie jar without exposing values: which sb-* (Supabase) cookies are
// present, how many, and their total size -- enough to catch a chunking/persistence
// mismatch (e.g. a session split across more cookies than the reading side expects) without
// logging anything an attacker could replay.
export function summarizeCookies(cookies: CookieLike[]) {
  const sb = cookies.filter((c) => c.name.startsWith('sb-'))
  return {
    totalCookieCount: cookies.length,
    sbCookieNames: sb.map((c) => c.name).sort(),
    sbCookieCount: sb.length,
    sbCookieTotalBytes: sb.reduce((sum, c) => sum + c.value.length, 0),
  }
}

export function errorInfo(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) return { message: err.message, name: err.name }
  return { message: String(err) }
}
