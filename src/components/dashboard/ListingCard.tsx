'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Archive, ImageOff, Loader2 } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatPrice, getMeasurementFields, detectClothingSubType } from '@/lib/utils'
import { detectJewelrySubType } from '@/lib/jewelry-detection'
import { MeasurementFields, type MeasurementFieldsHandle } from '@/components/workspace/MeasurementFields'
import type { ListingStatus, Measurements } from '@/types/listings'

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
  final_price_cents: number | null
  agent_blocked: boolean
  agent_blocked_reason: string | null
  pipeline_step: number
  pipeline_total: number
  skip_background_removal: boolean
}

interface CoverPhoto {
  raw_url: string
  processed_url: string | null
}

export interface ListingWithCover extends CardListing {
  coverPhoto?: CoverPhoto
}

// A human-set override always wins over the pipeline's own suggestion once one exists --
// resolveFinalPriceCents (pricing-adjust.ts) is the full precedence chain used at publish
// time, but the dashboard card doesn't load pricing_comps to compute the adjusted-comps term
// in the middle of that chain, so this is deliberately just the two fields the card actually
// has: final_price_cents ?? suggested_price_cents. Don't re-derive resolveFinalPriceCents'
// full chain inline here -- it needs `adjusted.priceCents`, which this component never fetches.
export function resolveDisplayPriceCents(
  listing: Pick<CardListing, 'final_price_cents' | 'suggested_price_cents'>
): number | null {
  return listing.final_price_cents ?? listing.suggested_price_cents
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

const CONDITION_RUBRIC: { grade: string; label: string; criteria: string }[] = [
  { grade: 'new_with_tags', label: 'New with tags', criteria: 'Tags attached, sealed original packaging' },
  { grade: 'new_without_tags', label: 'New without tags', criteria: 'Unworn; factory protections still in place' },
  { grade: 'like_new', label: 'Like new', criteria: 'Worn once or less, all surfaces pristine' },
  { grade: 'very_good', label: 'Very good', criteria: 'Light use, minor surface wear only' },
  { grade: 'good', label: 'Good', criteria: 'Visible wear, fully functional' },
  { grade: 'fair', label: 'Fair', criteria: 'Moderate wear, multiple visible flaws' },
  { grade: 'poor', label: 'Poor', criteria: 'Heavy wear, significant damage' },
  { grade: 'for_parts', label: 'For parts', criteria: 'Non-functional or severely damaged' },
]

function ConditionGatePhoto({
  listing,
  photoUrl,
}: Readonly<{
  listing: CardListing
  photoUrl?: string
}>) {
  return (
    <>
      {photoUrl ? (
        <Image src={photoUrl} alt={listing.title ?? 'Listing'} fill className="object-cover brightness-40" />
      ) : (
        <div className="absolute inset-0 bg-gray-900" />
      )}
      <div className="absolute inset-0 bg-gray-950/88 flex flex-col border border-amber-800/60 rounded-xl">
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 overflow-y-auto px-3 pt-2.5 pb-2 space-y-1">
            {CONDITION_RUBRIC.map(({ grade, label, criteria }) => (
              <div key={grade} className="leading-tight">
                <span className="text-[9px] text-amber-300/80 font-medium">{label} </span>
                <span className="text-[9px] text-gray-500">{criteria}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-0 inset-x-0 h-6 bg-linear-to-t from-gray-950/95 to-transparent pointer-events-none" />
        </div>
        <div className="flex-none px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider">Review condition</p>
          <Link
            href={`/listings/${listing.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block w-full py-1.5 text-[11px] font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-center transition-colors"
          >
            Open Workspace →
          </Link>
        </div>
      </div>
    </>
  )
}

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'mens', label: "Men's" },
  { value: 'womens', label: "Women's" },
  { value: 'unisex', label: 'Unisex' },
]

// Mirrors gate-messages.ts's GENDER_CATEGORIES -- kept in sync manually since that module
// pulls in server-oriented gate-building helpers this client component doesn't need.
const CATEGORIES_NEEDING_GENDER = new Set(['watches', 'clothing', 'sneakers'])

function GenderGatePhoto({
  listing,
  photoUrl,
  onSubmitted,
}: Readonly<{
  listing: CardListing
  photoUrl?: string
  onSubmitted: () => void
}>) {
  const category = listing.category ?? 'item'
  const notableFeatures = (listing.intake_meta?.visionAnalysis as { notable_features?: string[] } | undefined)?.notable_features ?? []
  const subTypeHint =
    category === 'clothing' ? detectClothingSubType(notableFeatures)
    : category === 'jewelry' ? detectJewelrySubType(notableFeatures)
    : null
  const measurementFields = getMeasurementFields(category, subTypeHint, notableFeatures)
  const needsGender = CATEGORIES_NEEDING_GENDER.has(category.toLowerCase())
  const needsMeasurements = measurementFields.length > 0

  const [gender, setGender] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const measurementFieldsRef = useRef<MeasurementFieldsHandle>(null)

  async function submit(measurements: Partial<Measurements> | null) {
    setSubmitting(true)
    try {
      await fetch('/api/pipeline/confirm-gender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: listing.id, gender, measurements }),
      })
      onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  function pickGender(value: string) {
    setGender(value)
    if (!needsMeasurements) void submit(null)
  }

  const showGenderPicker = needsGender && !gender
  const showMeasurements = needsMeasurements && (!needsGender || gender)

  return (
    <>
      {photoUrl ? (
        <Image src={photoUrl} alt={listing.title ?? 'Listing'} fill className="object-cover brightness-40" />
      ) : (
        <div className="absolute inset-0 bg-gray-900" />
      )}
      {/* preventDefault is the one that actually matters here -- stopPropagation alone stops
          other React handlers from firing but does nothing to the wrapping Link's native
          anchor navigation, which fires once the click's default isn't prevented regardless
          of where propagation was stopped. Without it, every chip/field click here fell
          through to the card's link instead of picking a gender or submitting measurements
          (ai-listings dashboard report, 2026-08-23). Matches handleConfirmId's pattern below. */}
      <div
        className="absolute inset-0 bg-gray-950/88 flex flex-col"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 overflow-y-auto px-3 pt-2.5 pb-2 space-y-2">
            <p className="text-[11px] font-semibold text-white leading-tight capitalize">{category.replaceAll('_', ' ')}</p>
            <p className="text-[10px] text-amber-400 font-medium">
              {submitting ? 'Saving…' : 'Needs a couple details before pricing'}
            </p>
            {showGenderPicker && (
              <div className="flex gap-1.5 flex-wrap">
                {GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => pickGender(opt.value)}
                    className="px-3 py-1 text-[11px] rounded-full border border-gray-700 text-gray-300 hover:border-emerald-500 hover:text-emerald-300 transition-colors disabled:opacity-50"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            {showMeasurements && (
              <MeasurementFields
                ref={measurementFieldsRef}
                fields={measurementFields}
                inputUnit="imperial"
                onSubmit={(m) => void submit(m)}
                compact
                hideButton
              />
            )}
          </div>
        </div>
        {showMeasurements && (
          // Sneakers' 6-field form (sizing system, size, US size, length, width, height) is
          // tall regardless of the compact layout above -- Continue lives outside the
          // scrollable region, same fixed-footer pattern as IdGatePhoto's buttons, so it's
          // never scrolled out of view no matter how many fields a category needs
          // (ai-listings dashboard report, 2026-08-23).
          <div className="flex-none px-3 py-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                measurementFieldsRef.current?.submit()
              }}
              className="w-full py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
            >
              {submitting ? '…' : 'Continue →'}
            </button>
          </div>
        )}
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
  const [genderGateSubmitted, setGenderGateSubmitted] = useState(false)
  const [skipBg, setSkipBg] = useState(listing.skip_background_removal)
  const [isTogglingSkip, setIsTogglingSkip] = useState(false)

  const isBlocked = listing.agent_blocked && listing.status === 'in_loop'
  const isIdGate = listing.status === 'id_gate' && !idConfirmed
  const isGenderGate = listing.status === 'gender_gate' && !genderGateSubmitted
  const isConditionGate = listing.status === 'condition_gate'
  const isProcessing =
    listing.status === 'intake' ||
    (listing.status === 'id_gate' && idConfirmed) ||
    (listing.status === 'gender_gate' && genderGateSubmitted)
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

  async function handleToggleSkipBg(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsTogglingSkip(true)
    const next = !skipBg
    setSkipBg(next)
    try {
      const res = await fetch(`/api/listings/${listing.id}/skip-bg`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip: next }),
      })
      if (!res.ok) throw new Error(`skip-bg update failed (${res.status})`)
    } catch {
      setSkipBg(!next)
    } finally {
      setIsTogglingSkip(false)
    }
  }

  let borderClass = 'border-gray-800 hover:border-gray-700'
  if (isBlocked) borderClass = 'border-red-900/60 hover:border-red-800/60'
  else if (isIdGate || isGenderGate || isConditionGate) borderClass = 'border-amber-800/60 hover:border-amber-700/60'

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
        {isGenderGate && (
          <GenderGatePhoto
            listing={listing}
            photoUrl={photoUrl}
            onSubmitted={() => setGenderGateSubmitted(true)}
          />
        )}
        {isConditionGate && (
          <ConditionGatePhoto
            listing={listing}
            photoUrl={photoUrl}
          />
        )}
        {isProcessing && (
          <>
            {photoUrl ? (
              <Image src={photoUrl} alt={listing.title ?? 'Listing'} fill className="object-cover brightness-40" />
            ) : (
              <div className="absolute inset-0 bg-gray-900" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950/40">
              <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
              <span className="text-[10px] text-gray-300">Processing…</span>
            </div>
          </>
        )}
        {!isBlocked && !isIdGate && !isGenderGate && !isConditionGate && !isProcessing && photoUrl && (
          <Image
            src={photoUrl}
            alt={listing.title ?? 'Listing'}
            fill
            className="object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        )}
        {!isBlocked && !isIdGate && !isGenderGate && !isConditionGate && !isProcessing && !photoUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-gray-700 text-xs">No photo</span>
          </div>
        )}
        <button
          onClick={handleToggleSkipBg}
          disabled={isTogglingSkip}
          title={skipBg ? 'Background removal skipped — click to re-enable' : 'Skip background removal'}
          className={`absolute top-1.5 left-1.5 z-20 transition-opacity rounded p-1 ${
            skipBg
              ? 'opacity-100 bg-amber-900/80 hover:bg-amber-800/80'
              : 'opacity-0 group-hover:opacity-100 bg-gray-900/80 hover:bg-gray-800/80'
          }`}
        >
          <ImageOff className={`w-3.5 h-3.5 ${skipBg ? 'text-amber-400' : 'text-gray-400'}`} />
        </button>
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
        {resolveDisplayPriceCents(listing) != null && (
          <p className="text-xs text-emerald-400 font-semibold">
            {formatPrice(resolveDisplayPriceCents(listing) as number)}
          </p>
        )}
      </div>
    </div>
  )

  if (isProcessing) return inner
  return <Link href={`/listings/${listing.id}`}>{inner}</Link>
}
