'use client'

import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface BlockedListingsBannerProps {
  blockedCount: number
}

export function BlockedListingsBanner({ blockedCount }: BlockedListingsBannerProps) {
  const [count, setCount] = useState(blockedCount)
  const [restarting, setRestarting] = useState(false)

  if (count === 0) return null

  async function handleRestart() {
    setRestarting(true)
    try {
      const res = await fetch('/api/pipeline/bulk-restart', { method: 'POST' })
      const data = (await res.json()) as { restarted?: number; error?: string }
      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Failed to restart — try again')
        return
      }
      toast.success(`Restarted ${data.restarted} listing${data.restarted === 1 ? '' : 's'}`)
      setCount(0)
    } catch {
      toast.error('Failed to restart — try again')
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-sm text-amber-200">
          <span className="font-medium">{count} listing{count === 1 ? '' : 's'}</span>
          {' '}failed during processing and need to be restarted.
        </p>
      </div>
      <button
        onClick={() => void handleRestart()}
        disabled={restarting}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/30 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${restarting ? 'animate-spin' : ''}`} />
        {restarting ? 'Restarting…' : 'Restart all failed'}
      </button>
    </div>
  )
}
