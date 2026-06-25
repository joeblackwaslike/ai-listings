'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { PhotoPanel } from './PhotoPanel'
import type { Photo } from '@/types/listings'

interface PhotoSectionProps {
  readonly photos: Photo[]
  readonly listingId: string
  readonly initialSkip: boolean
}

export function PhotoSection({ photos, listingId, initialSkip }: PhotoSectionProps) {
  const [skip, setSkip] = useState(initialSkip)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    const next = !skip
    setSkip(next)
    try {
      await fetch(`/api/listings/${listingId}/skip-bg`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip: next }),
      })
    } catch {
      setSkip(!next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={toggle}
          disabled={busy}
          title={skip ? 'Background removal skipped — click to re-enable' : 'Skip background removal'}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
            skip
              ? 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
              : 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'
          }`}
        >
          <ImageOff className="w-3 h-3" />
          {skip ? 'BG removal off' : 'Skip BG removal'}
        </button>
      </div>
      <PhotoPanel photos={photos} skipBgRemoval={skip} />
    </div>
  )
}
