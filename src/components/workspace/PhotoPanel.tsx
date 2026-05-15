'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Check, X, Plus } from 'lucide-react'
import type { Photo, PhotoShot, Inclusion } from '@/types/listings'

interface PhotoPanelProps {
  readonly photos: Photo[]
  readonly photoplan: PhotoShot[]
  readonly inclusions: Inclusion[]
  readonly listingId: string
}

const PHOTO_RANK: Record<string, number> = { studio: 0, processed: 1, auth_card: 2 }
function photoRank(p: Photo): number { return PHOTO_RANK[p.type] ?? 3 }

export function PhotoPanel({ photos, photoplan, inclusions: initialInclusions, listingId }: PhotoPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [inclusions, setInclusions] = useState<Inclusion[]>(initialInclusions)
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  const displayPhotos = photos.length > 0
    ? [...photos].sort((a, b) => photoRank(a) - photoRank(b) || a.display_order - b.display_order)
    : []

  const main = displayPhotos[selectedIdx]
  const mainUrl = main?.processed_url ?? main?.raw_url

  async function saveInclusions(updated: Inclusion[]) {
    setInclusions(updated)
    await fetch(`/api/listings/${listingId}/inclusions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inclusions: updated }),
    })
  }

  function removeInclusion(i: number) {
    saveInclusions(inclusions.filter((_, idx) => idx !== i))
  }

  function addInclusion() {
    const name = addInput.trim()
    if (!name) return
    saveInclusions([...inclusions, { item: name, included: true, notes: null }])
    setAddInput('')
    addInputRef.current?.focus()
  }

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
            {photoplan.map((shot) => (
              <li key={shot.shot} className="flex items-start gap-2">
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

      <section>
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Inclusions
        </h3>
        <ul className="space-y-1">
          {inclusions.map((item, i) => (
            <li key={item.item} className="flex items-center gap-2 group">
              {item.included ? (
                <Check className="w-3.5 h-3.5 flex-none text-emerald-500 shrink-0" />
              ) : (
                <X className="w-3.5 h-3.5 flex-none text-gray-700 shrink-0" />
              )}
              <span className={`text-xs flex-1 min-w-0 truncate ${item.included ? 'text-gray-300' : 'text-gray-600'}`}>
                {item.item}
                {item.notes && <span className="text-gray-600"> ({item.notes})</span>}
              </span>
              <button
                onClick={() => removeInclusion(i)}
                className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-red-400"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1.5 mt-2">
          <input
            ref={addInputRef}
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclusion() } }}
            placeholder="Add inclusion…"
            className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-0.5 transition-colors"
          />
          <button
            onClick={addInclusion}
            disabled={!addInput.trim()}
            className="flex-none text-gray-700 hover:text-emerald-400 disabled:opacity-30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    </div>
  )
}
