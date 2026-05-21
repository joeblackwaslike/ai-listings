'use client'

import { useState } from 'react'
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
  agent_blocked_reason: string | null
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

function BlockedPhoto({ photoUrl, reason }: Readonly<{ photoUrl?: string; reason: string | null }>) {
  return (
    <>
      {photoUrl ? (
        <Image src={photoUrl} alt="Listing" fill className="object-cover brightness-30" />
      ) : (
        <div className="absolute inset-0 bg-gray-900" />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
        <span className="text-red-400 text-lg">⚠</span>
        <p className="text-[10px] text-gray-300 leading-snug">{reason ?? 'Action required'}</p>
      </div>
    </>
  )
}

function IdGatePhoto({
  listing,
  photoUrl,
  features,
  idConfirming,
  onConfirm,
}: Readonly<{
  listing: CardListing
  photoUrl?: string
  features: string[]
  idConfirming: boolean
  onConfirm: (e: React.MouseEvent) => void
}>) {
  const brand = listing.brand ?? 'Unknown brand'
  const category = listing.category ?? 'unknown'
  const condition = (listing.condition ?? 'unknown').replaceAll('_', ' ')
  const notes = listing.condition_notes

  return (
    <>
      {photoUrl ? (
        <Image src={photoUrl} alt={listing.title ?? 'Listing'} fill className="object-cover brightness-40" />
      ) : (
        <div className="absolute inset-0 bg-gray-900" />
      )}
      <div className="absolute inset-0 bg-gray-950/88 flex flex-col">
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 overflow-y-auto px-3 pt-2.5 pb-2 space-y-2">
            <div>
              <p className="text-[11px] font-semibold text-white leading-tight">{brand}</p>
              <p className="text-[10px] text-gray-400 capitalize">{category} · {condition}</p>
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
            {notes && <p className="text-[10px] text-gray-500 leading-snug">{notes}</p>}
            <p className="text-[10px] text-amber-400 font-medium">Is this correct?</p>
            <div className="h-2" />
          </div>
          <div className="absolute bottom-0 inset-x-0 h-8 bg-linear-to-t from-gray-950/95 to-transparent pointer-events-none" />
        </div>
        <div className="flex-none px-3 py-2.5 flex gap-2">
          <button
            onClick={onConfirm}
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

  const isBlocked = listing.agent_blocked && listing.status === 'in_loop'
  const isIdGate = listing.status === 'id_gate' && !idConfirmed
  const isProcessing = listing.status === 'intake' || (listing.status === 'id_gate' && idConfirmed)
  const photoUrl = listing.coverPhoto?.processed_url ?? listing.coverPhoto?.raw_url
  const features = (listing.intake_meta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []

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

  let borderClass = 'border-gray-800 hover:border-gray-700'
  if (isBlocked) borderClass = 'border-red-900/60 hover:border-red-800/60'
  else if (isIdGate) borderClass = 'border-amber-800/60 hover:border-amber-700/60'

  const inner = (
    <div className={`bg-gray-900 rounded-xl overflow-hidden border transition-colors group ${borderClass}`}>
      <div className="relative aspect-square bg-gray-800">
        {isBlocked && <BlockedPhoto photoUrl={photoUrl} reason={listing.agent_blocked_reason} />}
        {isIdGate && (
          <IdGatePhoto
            listing={listing}
            photoUrl={photoUrl}
            features={features}
            idConfirming={idConfirming}
            onConfirm={handleConfirmId}
          />
        )}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
            <span className="text-[10px] text-gray-600">Processing…</span>
          </div>
        )}
        {!isBlocked && !isIdGate && !isProcessing && photoUrl && (
          <Image
            src={photoUrl}
            alt={listing.title ?? 'Listing'}
            fill
            className="object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        )}
        {!isBlocked && !isIdGate && !isProcessing && !photoUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-gray-700 text-xs">No photo</span>
          </div>
        )}
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
