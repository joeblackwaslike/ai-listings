import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { authLog, errorInfo } from '@/lib/auth-log'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (err) {
            // Called from a Server Component -- Next.js forbids cookie writes there, so a
            // session refreshed by this client (e.g. a Server Component page reading an
            // access token close to expiry) computes new tokens but can't persist them back
            // to the browser. This used to be a totally silent no-op; now it's logged so a
            // burst of these right before a "kicked to /login" report can confirm or rule
            // out this exact mechanism instead of guessing.
            authLog.warn('server_component_cookie_write_dropped', {
              cookieNames: cookiesToSet.map((c) => c.name),
              cookieCount: cookiesToSet.length,
              totalBytes: cookiesToSet.reduce((sum, c) => sum + c.value.length, 0),
              error: errorInfo(err),
            })
          }
        },
      },
    }
  )
}
