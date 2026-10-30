'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { PipelineTimeline } from './PipelineTimeline'
import { ListingTabs } from './ListingTabs'
import { DetailsList } from './DetailsList'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { FinalizingChecklist } from '@/components/workspace/FinalizingChecklist'
import { ConditionReviewPanel } from '@/components/workspace/ConditionReviewPanel'
import { CopyReviewPanel } from '@/components/workspace/CopyReviewPanel'
import { pipelineSettled } from '@/lib/pipeline/pipeline-end'
import type { Listing, Photo } from '@/types/listings'

interface FieldsPanelProps {
  listing: Listing
  photos: Photo[]
}

interface QaChecklistRowProps {
  photo: Photo
  onRetake: (photoId: string) => void
  onUseAsIs: (photoId: string) => Promise<void>
}

function QaChecklistRow({ photo, onRetake, onUseAsIs }: Readonly<QaChecklistRowProps>) {
  const meta = photo.photoroom_meta as { quality_verdict?: string } | null
  const [accepting, setAccepting] = useState(false)

  async function handleAccept() {
    setAccepting(true)
    await onUseAsIs(photo.id)
  }

  return (
    <div className="rounded bg-black/20 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-none w-10 h-10 rounded border border-red-700 overflow-hidden bg-gray-800">
          {photo.raw_url && <Image src={photo.raw_url} alt="" fill className="object-cover" />}
        </div>
        <p className="flex-1 min-w-0 text-[11px] text-orange-300">{meta?.quality_verdict ?? 'Quality issue'}</p>
      </div>
      <div className="flex gap-1.5 pl-12">
        <button
          onClick={() => onRetake(photo.id)}
          disabled={accepting}
          className="text-[10px] px-2 py-1 rounded bg-orange-900/50 text-orange-300 hover:bg-orange-900/70 transition-colors disabled:opacity-40"
        >
          Retake
        </button>
        <button
          onClick={() => void handleAccept()}
          disabled={accepting}
          className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
        >
          {accepting ? 'Processing…' : 'Use as-is'}
        </button>
      </div>
    </div>
  )
}

export function FieldsPanel({ listing, photos }: Readonly<FieldsPanelProps>) {
  const router = useRouter()
  // Derived, not copied into state: AutoRefresh re-renders with a new `listing` prop, and a stale
  // copy kept showing "Confirm photos" (whose click used to reset a confirmed condition).
  const [confirmedLocally, setConfirmedLocally] = useState(false)
  const photosConfirmed = listing.photos_confirmed || confirmedLocally
  const [confirmingPhotos, setConfirmingPhotos] = useState(false)
  const retakeTargetPhotoId = useRef<string | null>(null)
  const retakeFileInputRef = useRef<HTMLInputElement>(null)

  async function confirmPhotos() {
    setConfirmingPhotos(true)
    try {
      const res = await fetch(`/api/listings/${listing.id}/confirm-photos`, { method: 'PATCH' })
      if (res.ok) setConfirmedLocally(true)
      else toast.error("Couldn't confirm photos")
    } catch {
      toast.error("Couldn't confirm photos")
    } finally {
      setConfirmingPhotos(false)
    }
  }

  function startRetake(photoId: string) {
    retakeTargetPhotoId.current = photoId
    retakeFileInputRef.current?.click()
  }

  async function handleRetakeFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const replacesPhotoId = retakeTargetPhotoId.current
    e.target.value = ''
    if (!file || !replacesPhotoId) return

    const formData = new FormData()
    formData.append('photo', file)
    formData.append('listingId', listing.id)
    formData.append('replacesPhotoId', replacesPhotoId)
    const res = await fetch('/api/studio-upload', { method: 'POST', body: formData })
    if (!res.ok) {
      let msg = `Retake upload failed (${res.status})`
      try {
        const body = await res.json() as { error?: string }
        if (body.error) msg = body.error
      } catch { /* non-JSON body */ }
      throw new Error(msg)
    }
  }

  async function handleUseAsIs(photoId: string) {
    await fetch(`/api/photos/${photoId}/quality-override`, { method: 'PATCH' })
    router.refresh()
  }

  // Auto-discount per-listing override state
  const [adOverride, setAdOverride] = useState(
    listing.auto_discount_enabled !== null ||
    listing.auto_discount_pct !== null ||
    listing.auto_discount_interval_days !== null
  )
  const [adEnabled, setAdEnabled] = useState<boolean>(listing.auto_discount_enabled ?? false)
  const [adPct, setAdPct] = useState<string>(String(listing.auto_discount_pct ?? 10))
  const [adIntervalDays, setAdIntervalDays] = useState<string>(String(listing.auto_discount_interval_days ?? 14))

  async function saveAdOverride(patch: {
    auto_discount_enabled?: boolean | null
    auto_discount_pct?: number | null
    auto_discount_interval_days?: number | null
  }) {
    await fetch(`/api/listings/${listing.id}/auto-discount`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  function handleAdOverrideToggle() {
    const next = !adOverride
    setAdOverride(next)
    if (!next) {
      // Clear overrides
      void saveAdOverride({
        auto_discount_enabled: null,
        auto_discount_pct: null,
        auto_discount_interval_days: null,
      })
    }
  }

  const studioPhotos = photos.filter((p) => p.type === 'studio')

  return (
    <>
      <div className="space-y-5">
        {(() => {
          const flaggedPhotos = photos.filter(
            (p) => p.type === 'studio' && (p.photoroom_meta as { quality_failed?: boolean } | null)?.quality_failed
          )
          // Flagged photos block publishing whatever the block fields say, so their Retake /
          // Use-as-is actions must stay reachable even if another path cleared agent_blocked.
          if (flaggedPhotos.length > 0) {
            return (
              <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5 space-y-3">
                <p className="text-xs font-medium text-orange-400">
                  Agent waiting — {flaggedPhotos.length} photo{flaggedPhotos.length === 1 ? '' : 's'} need{flaggedPhotos.length === 1 ? 's' : ''} attention
                </p>
                {flaggedPhotos.map((photo) => (
                  <QaChecklistRow key={photo.id} photo={photo} onRetake={startRetake} onUseAsIs={handleUseAsIs} />
                ))}
                <input
                  ref={retakeFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleRetakeFileSelected(e)}
                />
              </div>
            )
          }
          if (listing.agent_blocked && listing.agent_blocked_reason) {
            return (
              <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5">
                <p className="text-xs font-medium text-orange-400 mb-0.5">Agent waiting</p>
                <p className="text-xs text-orange-300/80">{listing.agent_blocked_reason}</p>
              </div>
            )
          }
          return null
        })()}

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-gray-600">{listing.sku ?? '—'}</span>
            <StatusBadge listing={listing} hasStudioPhotos={studioPhotos.length > 0} />
          </div>
          <h1 className="text-base font-semibold leading-snug text-gray-100">
            {listing.title ?? listing.brand ?? 'Untitled'}
          </h1>
        </div>

        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-[220px_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Status</h3>
              <PipelineTimeline listing={listing} photos={photos} />
            </section>
            <ListingTabs listing={listing} photosConfirmed={photosConfirmed} />
          </div>
        </div>

        {!photosConfirmed && pipelineSettled(listing) && studioPhotos.length > 0 && studioPhotos.every((p) => p.processed_url !== null) && (
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Photos
              </h3>
              <button
                onClick={() => void confirmPhotos()}
                disabled={confirmingPhotos}
                className="text-[10px] px-2 py-1 rounded bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60 disabled:opacity-50 transition-colors"
              >
                {confirmingPhotos ? 'Confirming…' : 'Confirm photos ✓'}
              </button>
            </div>
          </section>
        )}

        {/* Condition is confirmed only in condition_gate, through confirm-condition, which starts
            the rewrite that leads to copy review. A separate inline approve elsewhere left listings
            in in_loop with condition confirmed and no path to copy approval. */}
        {listing.status === 'condition_gate' && <ConditionReviewPanel listing={listing} />}
        {listing.status === 'copy_review' && <CopyReviewPanel listing={listing} />}

        <DetailsList listing={listing} conditionConfirmed={listing.condition_confirmed} />

        {listing.status === 'finalizing' && <FinalizingChecklist listing={listing} />}

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Auto-Discount
            </h3>
            <button
              onClick={handleAdOverrideToggle}
              className="text-[10px] text-gray-600 hover:text-emerald-400 transition-colors"
            >
              {adOverride ? 'Clear override' : 'Override'}
            </button>
          </div>

          {adOverride ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Enabled</span>
                <button
                  onClick={() => {
                    const next = !adEnabled
                    setAdEnabled(next)
                    void saveAdOverride({ auto_discount_enabled: next })
                  }}
                  className={`relative inline-flex h-4 w-8 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                    adEnabled ? 'bg-emerald-500' : 'bg-gray-700'
                  }`}
                  role="switch"
                  aria-checked={adEnabled}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                      adEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-[10px] text-gray-500 flex-none">Discount %</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={adPct}
                  onChange={(e) => setAdPct(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(adPct)
                    if (!isNaN(n) && n > 0) void saveAdOverride({ auto_discount_pct: n })
                  }}
                  className="w-20 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-[10px] text-gray-500 flex-none">Interval (days)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={adIntervalDays}
                  onChange={(e) => setAdIntervalDays(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(adIntervalDays, 10)
                    if (!isNaN(n) && n > 0) void saveAdOverride({ auto_discount_interval_days: n })
                  }}
                  className="w-20 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
                />
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-gray-700">Using global auto-discount settings</p>
          )}
        </section>

      </div>
    </>
  )
}
