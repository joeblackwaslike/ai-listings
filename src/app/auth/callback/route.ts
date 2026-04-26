import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', request.url))
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
    return NextResponse.redirect(new URL('/auth/error?reason=exchange_failed', request.url))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_user', request.url))
  }

  const mode = process.env.REGISTRATION_MODE ?? 'open'
  const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const userEmail = (user.email ?? '').toLowerCase()
  if (mode === 'whitelist' && !allowedEmails.map((e) => e.toLowerCase()).includes(userEmail)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/auth/error?reason=not_allowed', request.url))
  }

  if (mode === 'closed') {
    const createdAt = new Date(user.created_at).getTime()
    const isNewUser = Date.now() - createdAt < 60_000
    if (isNewUser) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/auth/error?reason=closed', request.url))
    }
  }

  return NextResponse.redirect(new URL('/dashboard', origin))
}
