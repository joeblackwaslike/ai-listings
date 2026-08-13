'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Server-rendered pages showing background pipeline state (a listing processing, a job
// blocking) have no push/realtime channel — nothing re-fetches until something triggers it.
// Poll periodically and on refocus instead of requiring a manual reload. Pass `active={false}`
// once there's nothing left to change (e.g. a finished or archived listing) to stop polling.
const REFRESH_INTERVAL_MS = 30_000

export function AutoRefresh({ active = true }: { active?: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return

    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS)

    function handleVisibility() {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [router, active])

  return null
}
