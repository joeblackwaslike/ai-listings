'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Check, X } from 'lucide-react'
import type { Photo, PhotoShot, Inclusion } from '@/types/listings'

interface PhotoPanelProps {
  photos: Photo[]
  photoplan: PhotoShot[]
  inclusions: Inclusion[]
}

export function PhotoPanel({ photos, photoplan, inclusions }: PhotoPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  const displayPhotos = photos.length > 0
    ? [...photos].sort((a, b) => {
        const rank = (p: Photo) =>
          p.type === 'studio' ? 0 : p.type === 'processed' ? 1 : p.type === 'auth_card' ? 2 : 3
        return rank(a) - rank(b) || a.display_order - b.display_order
      })
    : []

  const main = displayPhotos[selectedIdx]
  const mainUrl = main?.processed_url ?? main?.raw_url

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
                const url = photo.processed_url ?? photo.raw_url
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

      {photoplan.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Photo Plan
          </h3>
          <ul className="space-y-2">
            {photoplan.map((shot, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-0.5 flex-none w-3.5 h-3.5 rounded border ${shot.required ? 'border-gray-600' : 'border-gray-700'}`} />
                <div className="min-w-0">
                  <span className="text-xs text-gray-300">{shot.shot}</span>
                  {shot.required && <span className="ml-1 text-[10px] text-orange-500">required</span>}
                  <p className="text-[10px] text-gray-600 leading-snug">{shot.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inclusions.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Inclusions
          </h3>
          <ul className="space-y-1.5">
            {inclusions.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                {item.included ? (
                  <Check className="w-3.5 h-3.5 flex-none text-emerald-500" />
                ) : (
                  <X className="w-3.5 h-3.5 flex-none text-gray-700" />
                )}
                <span className={`text-xs ${item.included ? 'text-gray-300' : 'text-gray-600'}`}>
                  {item.item}
                </span>
                {item.notes && <span className="text-[10px] text-gray-600">({item.notes})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
