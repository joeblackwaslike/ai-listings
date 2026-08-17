import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authLog, summarizeCookies, errorInfo } from '@/lib/auth-log'

// Pure string check, pulled out so it's available in proxy()'s catch even when checkAuth()
// throws before it would otherwise compute this -- a Supabase outage must not turn /login
// and /auth/* into a redirect-to-/login loop, or make the callback route unreachable at
// exactly the moment a user needs it to recover.
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/inngest') ||
    // Platform-connect OAuth routes — the callback leg always arrives on the narrow public
    // domain (joeblack.nyc), which never carries a session cookie by design (cross-domain from
    // where the user is authenticated). Both routes do their own authorization internally:
    // connect/[platform] checks its own session (it runs on the authenticated domain in the
    // normal flow), and callback/[platform] identifies the user via the oauth_states table
    // instead of a session. See src/lib/oauth-states.ts.
    pathname.startsWith('/api/auth/connect') ||
    pathname.startsWith('/api/auth/callback')
  )
}

async function checkAuth(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request })
  let refreshedCookies: { name: string; length: number }[] | null = null

  const incomingCookies = summarizeCookies(request.cookies.getAll())

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          refreshedCookies = cookiesToSet.map(({ name, value }) => ({ name, length: value.length }))
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: getUserError } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  const agentToken = process.env.AGENT_BYPASS_TOKEN
  const hasAgentToken = Boolean(agentToken && request.headers.get('x-agent-token') === agentToken)

  const pagePublic = isPublicPath(pathname)

  authLog.info('proxy_check', {
    path: pathname,
    incomingCookies,
    userFound: Boolean(user),
    userId: user?.id ?? null,
    getUserError: getUserError ? errorInfo(getUserError) : null,
    sessionRefreshed: refreshedCookies !== null,
    refreshedCookies,
    isPublicPath: pagePublic,
    hasAgentToken,
  })

  if (!user && !pagePublic && !hasAgentToken) {
    // A null user here does not necessarily mean the session is truly dead -- @supabase/ssr's
    // own docs call out that refresh tokens are single-use, so two near-simultaneous requests
    // carrying the same not-yet-rotated token will race, and the loser sees exactly this: no
    // error thrown, just a null user. Logging the full incoming-cookie state (was there even
    // an sb-* cookie to work with, and how many) is what lets this be told apart after the
    // fact from a genuinely absent/expired session versus a lost race.
    authLog.warn('proxy_redirect_to_login', {
      path: pathname,
      incomingCookies,
      getUserError: getUserError ? errorInfo(getUserError) : null,
      hadAnySbCookies: incomingCookies.sbCookieCount > 0,
    })
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export async function proxy(request: NextRequest) {
  try {
    return await checkAuth(request)
  } catch (err) {
    const { pathname } = request.nextUrl
    authLog.error('proxy_unexpected_error', {
      path: pathname,
      error: errorInfo(err),
    })
    // Fail closed for protected paths: an unexpected exception in the auth check (a malformed
    // cookie crashing the parser, a network error reaching Supabase, etc.) must never be
    // allowed to silently skip the auth gate and let an unauthenticated request through.
    // But redirecting /login or /auth/* to /login on every throw turns a transient Supabase
    // outage into an actual redirect loop on the login page itself, and makes /auth/callback
    // unreachable at exactly the moment a user needs it to recover -- pass those through
    // instead (found by chatgpt-codex-connector review on PR #37).
    if (isPublicPath(pathname)) {
      return NextResponse.next({ request })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
