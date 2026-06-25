'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Photo } from '@/types/listings'

interface PhotoPanelProps {
  readonly photos: Photo[]
  readonly skipBgRemoval?: boolean
}

const PHOTO_RANK: Record<string, number> = { studio: 0, processed: 1, auth_card: 2 }
function photoRank(p: Photo): number { return PHOTO_RANK[p.type] ?? 3 }

export function PhotoPanel({ photos, skipBgRemoval = false }: PhotoPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  const displayPhotos = [...photos].sort((a, b) => photoRank(a) - photoRank(b) || a.display_order - b.display_order)
  const main = displayPhotos[selectedIdx]
  const mainUrl = skipBgRemoval ? main?.raw_url : (main?.processed_url ?? main?.raw_url)

  return (
    <div className="space-y-6">
      {displayPhotos.length > 0 ? (
        <div className="space-y-2">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
            {mainUrl && (
              <Image src={mainUrl} alt="Listing photo" fill className="object-contain" />
            )}
            {main && (
              <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-gray-400 capitalize">
                {main.type}
              </span>
            )}
          </div>
          {displayPhotos.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {displayPhotos.map((photo, i) => {
                const url = skipBgRemoval ? photo.raw_url : (photo.processed_url ?? photo.raw_url)
                return (
                  <button
                    key={photo.id}
                    onClick={() => setSelectedIdx(i)}
                    className={`relative flex-none w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === selectedIdx ? 'border-emerald-500' : 'border-transparent opacity-60 hover:opacity-80'
                    }`}
                  >
                    <Image src={url} alt="" fill className="object-cover" />
                  </button>
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
