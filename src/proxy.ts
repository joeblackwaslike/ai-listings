import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  const agentToken = process.env.AGENT_BYPASS_TOKEN
  const hasAgentToken = agentToken && request.headers.get('x-agent-token') === agentToken

  const isPublicPath =
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

  if (!user && !isPublicPath && !hasAgentToken) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
