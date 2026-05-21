'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Archive, Loader2 } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatPrice } from '@/lib/utils'
import type { ListingStatus } from '@/types/listings'

interface CardListing {
  id: string
  sku: string | null
  status: ListingStatus
  title: string | null
  brand: string | null
  category: string | null
  condition: string | null
  condition_notes: string | null
  intake_meta: Record<string, unknown> | null
  suggested_price_cents: number | null
  agent_blocked: boolean
  pipeline_step: number
  pipeline_total: number
}

interface CoverPhoto {
  raw_url: string
  processed_url: string | null
}

export interface ListingWithCover extends CardListing {
  coverPhoto?: CoverPhoto
}

export function ListingCard({
  listing,
  onArchive,
}: Readonly<{
  listing: ListingWithCover
  onArchive?: (id: string) => void
}>) {
  const [isArchiving, setIsArchiving] = useState(false)
  const [idConfirmed, setIdConfirmed] = useState(false)
  const [idConfirming, setIdConfirming] = useState(false)

  const isIdGate = listing.status === 'id_gate' && !idConfirmed
  const isProcessing = listing.status === 'intake' || (listing.status === 'id_gate' && idConfirmed)
  const photoUrl = listing.coverPhoto?.processed_url ?? listing.coverPhoto?.raw_url

  const visionMeta = listing.intake_meta?.visionAnalysis as {
    notable_features?: string[]
  } | undefined

  async function handleArchive(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsArchiving(true)
    try {
      const res = await fetch(`/api/listings/${listing.id}/archive`, { method: 'PATCH' })
      if (res.ok) onArchive?.(listing.id)
    } finally {
      setIsArchiving(false)
    }
  }

  async function handleConfirmId(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIdConfirming(true)
    try {
      await fetch('/api/pipeline/confirm-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: listing.id, confirmed: true }),
      })
      setIdConfirmed(true)
    } finally {
      setIdConfirming(false)
    }
  }

  let photoContent: ReactNode
  if (isIdGate) {
    const brand = listing.brand ?? 'Unknown brand'
    const category = listing.category ?? 'unknown'
    const condition = (listing.condition ?? 'unknown').replace(/_/g, ' ')
    const notes = listing.condition_notes
    const features = visionMeta?.notable_features ?? []

    photoContent = (
      <>
        {photoUrl ? (
          <Image src={photoUrl} alt={listing.title ?? 'Listing'} fill className="object-cover brightness-40" />
        ) : (
          <div className="absolute inset-0 bg-gray-900" />
        )}

        {/* Scrollable overlay covering full photo */}
        <div className="absolute inset-0 bg-gray-950/88 flex flex-col">
          {/* Scroll area */}
          <div className="relative flex-1 min-h-0">
            <div className="absolute inset-0 overflow-y-auto px-3 pt-2.5 pb-2 space-y-2">
              <div>
                <p className="text-[11px] font-semibold text-white leading-tight">{brand}</p>
                <p className="text-[10px] text-gray-400 capitalize">{category} · {condition}</p>
                {notes && <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{notes}</p>}
              </div>
              {features.length > 0 && (
                <ul className="space-y-0.5">
                  {features.map((f) => (
                    <li key={f} className="text-[10px] text-gray-400 flex gap-1.5 leading-snug">
                      <span className="text-gray-600 flex-none mt-px">·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-amber-400 font-medium">Is this correct?</p>
              {/* Extra padding so last item clears the fade */}
              <div className="h-2" />
            </div>
            {/* Scroll fade — shows there's more below */}
            <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-gray-950/95 to-transparent pointer-events-none" />
          </div>

          {/* Pinned action buttons */}
          <div className="flex-none px-3 py-2.5 flex gap-2">
            <button
              onClick={handleConfirmId}
              disabled={idConfirming}
              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
            >
              {idConfirming ? '…' : '✓ Yes'}
            </button>
            <Link
              href={`/listings/${listing.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-center transition-colors"
            >
              Fix it →
            </Link>
          </div>
        </div>
      </>
    )
  } else if (isProcessing) {
    photoContent = (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
        <span className="text-[10px] text-gray-600">Processing…</span>
      </div>
    )
  } else if (photoUrl) {
    photoContent = (
      <Image
        src={photoUrl}
        alt={listing.title ?? 'Listing'}
        fill
        className="object-cover group-hover:scale-[1.02] transition-transform duration-200"
      />
    )
  } else {
    photoContent = (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-gray-700 text-xs">No photo</span>
      </div>
    )
  }

  const inner = (
    <div className={`bg-gray-900 rounded-xl overflow-hidden border transition-colors group ${isIdGate ? 'border-amber-800/60 hover:border-amber-700/60' : 'border-gray-800 hover:border-gray-700'}`}>
      <div className="relative aspect-square bg-gray-800">
        {photoContent}
        <button
          onClick={handleArchive}
          disabled={isArchiving}
          title="Archive listing"
          className="absolute top-1.5 right-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900/80 hover:bg-red-950/80 rounded p-1"
        >
          {isArchiving ? (
            <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
          ) : (
            <Archive className="w-3.5 h-3.5 text-gray-400" />
          )}
        </button>
      </div>
      <div className="p-2.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-gray-600 font-mono truncate">{listing.sku ?? '—'}</span>
          <StatusBadge listing={listing} />
        </div>
        <p className="text-xs font-medium text-gray-200 line-clamp-2 leading-snug">
          {listing.title ?? listing.brand ?? 'Untitled'}
        </p>
        {listing.suggested_price_cents != null && (
          <p className="text-xs text-emerald-400 font-semibold">
            {formatPrice(listing.suggested_price_cents)}
          </p>
        )}
      </div>
    </div>
  )

  if (isProcessing) return inner
  return <Link href={`/listings/${listing.id}`}>{inner}</Link>
}
