'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Settings, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { IntakeModal } from './IntakeModal'

interface DashboardHeaderProps {
  listingsCount: number
}

export function DashboardHeader({ listingsCount }: DashboardHeaderProps) {
  const [modalOpen, setModalOpen] = useState(false)

  async function handleTextSubmit(entries: string[]) {
    setModalOpen(false)

    try {
      const res = await fetch('/api/intake-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })

      if (!res.ok) {
        toast.error('Failed to start intake — please try again')
        return
      }

      const data = (await res.json()) as {
        results: Array<{ listingId: string; description: string }>
      }

      for (const item of data.results) {
        toast.success(`"${item.description.slice(0, 50)}" — pipeline started`)
      }
    } catch {
      toast.error('Network error — please try again')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">AI Listings</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{listingsCount} listings</span>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-800 text-zinc-400 hover:text-white hover:bg-gray-700 transition-colors"
            aria-label="Add listing"
          >
            <Plus className="h-4 w-4" />
          </button>
          <Link
            href="/settings"
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <Settings className="h-5 w-5" />
          </Link>
          <NotificationBell />
        </div>
      </div>

      {modalOpen && (
        <IntakeModal
          onClose={() => setModalOpen(false)}
          onTextSubmit={handleTextSubmit}
        />
      )}
    </>
  )
}
