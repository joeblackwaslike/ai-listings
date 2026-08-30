'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { RotateCcw, ImageOff, Image as ImageIcon } from 'lucide-react'
import type { Photo } from '@/types/listings'

interface PhotoPanelProps {
  readonly photos: Photo[]
  readonly listingId: string
}

const PHOTO_RANK: Record<string, number> = { studio: 0, processed: 1, auth_card: 2 }
function photoRank(p: Photo): number { return PHOTO_RANK[p.type] ?? 3 }

function bgRemoved(photo: Photo): boolean {
  const raw = (photo.raw_url as string | null)?.split('?')[0]
  const processed = (photo.processed_url as string | null)?.split('?')[0]
  return !!(processed && processed !== raw)
}

export function PhotoPanel({ photos, listingId }: PhotoPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const displayPhotos = [...photos]
    .filter((p) => p.type !== 'intake')
    .sort((a, b) => photoRank(a) - photoRank(b) || a.display_order - b.display_order)
  const main = displayPhotos[selectedIdx]
  const mainUrl = main?.processed_url ?? main?.raw_url

  const photoAction = useCallback(async (photoId: string, endpoint: string, body?: object) => {
    setBusy((prev) => ({ ...prev, [photoId]: true }))
    try {
      await fetch(`/api/photos/${photoId}/${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      router.refresh()
    } finally {
      setBusy((prev) => ({ ...prev, [photoId]: false }))
    }
  }, [router])

  return (
    <div className="space-y-6">
      {displayPhotos.length > 0 ? (
        <div className="space-y-2">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
            {mainUrl && (
              <Image src={mainUrl as string} alt="Listing photo" fill className="object-contain" />
            )}
            {main && (
              <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-gray-400 capitalize">
                {main.type}
              </span>
            )}
          </div>
          {displayPhotos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {displayPhotos.map((photo, i) => {
                const url = (photo.processed_url ?? photo.raw_url) as string
                const isStudio = photo.type === 'studio'
                const isBusy = busy[photo.id as string]
                const hasBgRemoval = bgRemoved(photo)
                return (
                  <div key={photo.id as string} className="relative flex-none group">
                    <button
                      onClick={() => setSelectedIdx(i)}
                      className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors block ${
                        i === selectedIdx ? 'border-emerald-500' : 'border-transparent opacity-60 hover:opacity-80'
                      }`}
                    >
                      <Image src={url} alt="" fill className="object-cover" />
                    </button>
                    {isStudio && (
                      <div className="absolute inset-0 rounded-lg flex items-end justify-end gap-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <button
                          onClick={(e) => { e.stopPropagation(); void photoAction(photo.id as string, 'rotate') }}
                          disabled={isBusy}
                          title="Rotate left"
                          className="pointer-events-auto w-6 h-6 rounded bg-black/70 flex items-center justify-center text-white hover:bg-black/90 disabled:opacity-40 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void photoAction(photo.id as string, 'bg-removal', { action: hasBgRemoval ? 'skip' : 'apply' }) }}
                          disabled={isBusy}
                          title={hasBgRemoval ? 'Revert background removal' : 'Apply background removal'}
                          className="pointer-events-auto w-6 h-6 rounded bg-black/70 flex items-center justify-center text-white hover:bg-black/90 disabled:opacity-40 transition-colors"
                        >
                          {hasBgRemoval
                            ? <ImageOff className="w-3 h-3" />
                            : <ImageIcon className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-square rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600">No photos yet</p>
        </div>
      )}
    </div>
  )
}
