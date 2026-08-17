import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  // Prefer APP_URL -- the same "where the user's browser actually lives" env var the
  // platform-OAuth routes already use (src/app/api/auth/connect|callback/[platform]) --
  // over deriving the origin from request.url. Behind this deployment's Tailscale ingress,
  // request.url's origin resolves to http://0.0.0.0:3000 (the standalone server's own
  // HOSTNAME/PORT bind config, deployment/Dockerfile), not the public hostname, because
  // the ingress doesn't hand Next.js a usable Host header. Never NEXT_PUBLIC_SITE_URL
  // either -- that points at the separate public joeblack.nyc domain (platform OAuth
  // callbacks only), which 404s for sign-in and wouldn't carry the session cookie
  // exchangeCodeForSession scopes to this request's own domain (2026-08-15 incident).
  // APP_URL is unset in local dev, where request.url already resolves correctly (no
  // proxy in the way), so fall back to it there.
  const origin = process.env.APP_URL ?? new URL(request.url).origin
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', origin))
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return NextResponse.redirect(new URL('/auth/error?reason=exchange_failed', origin))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_user', origin))
  }

  const mode = process.env.REGISTRATION_MODE ?? 'open'
  const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const userEmail = (user.email ?? '').toLowerCase()
  if (mode === 'whitelist' && !allowedEmails.map((e) => e.toLowerCase()).includes(userEmail)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/auth/error?reason=not_allowed', origin))
  }

  if (mode === 'closed') {
    const createdAt = new Date(user.created_at).getTime()
    const isNewUser = Date.now() - createdAt < 60_000
    if (isNewUser) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/auth/error?reason=closed', origin))
    }
  }

  return NextResponse.redirect(new URL('/dashboard', origin))
}
