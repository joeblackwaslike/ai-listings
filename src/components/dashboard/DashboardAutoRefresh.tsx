'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The dashboard is server-rendered with no push/realtime channel, so background pipeline
// changes (a listing becoming blocked, a step completing) don't show up until something
// re-fetches. Poll periodically and on refocus instead of requiring a manual reload.
const REFRESH_INTERVAL_MS = 30_000

export function DashboardAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS)

    function handleVisibility() {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [router])

  return null
}
