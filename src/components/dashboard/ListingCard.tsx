import Link from 'next/link'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatPrice } from '@/lib/utils'
import type { ListingStatus } from '@/types/listings'

interface CardListing {
  id: string
  sku: string | null
  status: ListingStatus
  title: string | null
  brand: string | null
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

export function ListingCard({ listing }: { listing: ListingWithCover }) {
  const isProcessing = listing.status === 'intake' || listing.status === 'id_gate'
  const photoUrl = listing.coverPhoto?.processed_url ?? listing.coverPhoto?.raw_url

  const inner = (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-gray-700 transition-colors group">
      <div className="relative aspect-square bg-gray-800">
        {isProcessing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
            <span className="text-[10px] text-gray-600">Processing…</span>
          </div>
        ) : photoUrl ? (
          <Image
            src={photoUrl}
            alt={listing.title ?? 'Listing'}
            fill
            className="object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-gray-700 text-xs">No photo</span>
          </div>
        )}
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
