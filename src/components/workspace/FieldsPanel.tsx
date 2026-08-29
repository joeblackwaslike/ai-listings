'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ChevronRight, Check, CheckCircle2, Circle, AlertCircle, Plus, SkipForward, X, Pencil } from 'lucide-react'
import { formatPrice, getMeasurementFields } from '@/lib/utils'
import { formatMeasurementValue } from '@/lib/units'
import { notableFeaturesOf } from '@/lib/pipeline/gate-messages'
import { EvidenceDrawer } from './EvidenceDrawer'
import { PipelineTimeline } from './PipelineTimeline'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { FinalizingChecklist } from '@/components/workspace/FinalizingChecklist'
import { ConditionReviewPanel } from '@/components/workspace/ConditionReviewPanel'
import { getInclusionChecklist } from '@/lib/inclusions'
import { adjustForCondition, computeAdjustedPricing, conditionDelta, isPricingGateUnlocked, resolveFinalPriceCents } from '@/lib/pipeline/pricing-adjust'
import type { Listing, Photo, PricingComp, AuthStep, Inclusion, ListingPriceEvent, PlatformPriceEvent } from '@/types/listings'

interface FieldsPanelProps {
  listing: Listing
  photos: Photo[]
  comps: PricingComp[]
  priceHistory: ListingPriceEvent[]
  platformPriceHistory: PlatformPriceEvent[]
}

const CONDITION_LABELS: Record<string, string> = {
  new_with_tags: 'New with Tags',
  new_without_tags: 'New without Tags',
  like_new: 'Like New',
  very_good: 'Very Good',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  for_parts: 'For Parts',
}

const STEP_CYCLE: Record<AuthStep['status'], AuthStep['status']> = {
  pending: 'done',
  done: 'failed',
  failed: 'pending',
}

function AuthStepIcon({ status }: Readonly<{ status: AuthStep['status'] }>) {
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />
  return <Circle className="w-3.5 h-3.5 text-gray-700 hover:text-gray-400 transition-colors" />
}

interface QaChecklistRowProps {
  photo: Photo
  onRetake: (photoId: string) => void
  onUseAsIs: (photoId: string) => Promise<void>
}

function QaChecklistRow({ photo, onRetake, onUseAsIs }: Readonly<QaChecklistRowProps>) {
  const meta = photo.photoroom_meta as { quality_verdict?: string } | null
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
          className="text-[10px] px-2 py-1 rounded bg-orange-900/50 text-orange-300 hover:bg-orange-900/70 transition-colors"
        >
          Retake
        </button>
        <button
          onClick={() => void onUseAsIs(photo.id)}
          className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
        >
          Use as-is
        </button>
      </div>
    </div>
  )
}

export function FieldsPanel({ listing, photos, comps, priceHistory, platformPriceHistory }: Readonly<FieldsPanelProps>) {
  const router = useRouter()
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [priceOverrideOpen, setPriceOverrideOpen] = useState(false)
  const [priceOverrideInput, setPriceOverrideInput] = useState('')
  const [savingPriceOverride, setSavingPriceOverride] = useState(false)
  const [authSteps, setAuthSteps] = useState<AuthStep[]>(listing.auth_plan ?? [])
  const [saving, setSaving] = useState(false)
  const [inclusions, setInclusions] = useState<Inclusion[]>(listing.inclusions ?? [])
  const [conditionConfirmed, setConditionConfirmed] = useState(listing.condition_confirmed)
  const [refreshingPlan, setRefreshingPlan] = useState(false)
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)
  const retakeTargetPhotoId = useRef<string | null>(null)
  const retakeFileInputRef = useRef<HTMLInputElement>(null)
  const savingInclusionsRef = useRef(false)
  const savingConditionRef = useRef(false)

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
    await fetch('/api/studio-upload', { method: 'POST', body: formData })
  }

  async function handleUseAsIs(photoId: string) {
    await fetch(`/api/photos/${photoId}/quality-override`, { method: 'PATCH' })
  }

  // AutoRefresh polls via router.refresh(), which re-renders this client component with a new
  // `listing` prop but does not re-run useState's initializer -- without this, inclusions
  // detected asynchronously from studio photos (photo-quality-gate.ts) never appear here until
  // a full page reload. Guarded by savingInclusionsRef so a refresh landing mid-save doesn't
  // clobber an optimistic local update with a not-yet-persisted server value.
  useEffect(() => {
    if (savingInclusionsRef.current) return
    setInclusions(listing.inclusions ?? [])
  }, [listing.inclusions])

  useEffect(() => {
    if (savingConditionRef.current) return
    setConditionConfirmed(listing.condition_confirmed)
  }, [listing.condition_confirmed])

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

  const doneCount = authSteps.filter((s) => s.status === 'done').length
  const failedCount = authSteps.filter((s) => s.status === 'failed').length

  const notableFeatures = notableFeaturesOf(listing.intake_meta)
  const measurementFields = getMeasurementFields(listing.category ?? '', listing.sub_type, notableFeatures)
  const populatedMeasurements = listing.measurements
    ? measurementFields.filter((field) => {
        const value = (listing.measurements as Record<string, unknown>)[field.key]
        return value !== undefined && value !== null && value !== ''
      })
    : []

  const checklistCandidates = getInclusionChecklist(listing.category ?? '', listing.sub_type)
    .filter((c) => !inclusions.some((i) => i.item.trim().toLowerCase() === c.item.trim().toLowerCase()))

  const gateUnlocked = isPricingGateUnlocked({ condition_confirmed: conditionConfirmed, inclusions })
  // Price off the local optimistic `inclusions` state, not `listing.inclusions` (the stale
  // server-rendered prop) -- otherwise a just-confirmed/added/removed inclusion changes
  // gateUnlocked immediately but the displayed price keeps using the old inclusion set until
  // the next poll (which is disabled entirely for published/archived listings).
  const pricing = computeAdjustedPricing({ ...listing, inclusions }, comps, { includePremiums: gateUnlocked })
  // The exact number buildUnifiedListingForEbay will publish -- not just computeAdjustedPricing's
  // raw result, which misses both a final_price_cents override and the suggested_price_cents
  // fallback for the zero-comps case.
  const resolvedPriceCents = resolveFinalPriceCents(listing, pricing)
  // Only "provisional" when we're actually displaying computeAdjustedPricing's gated result --
  // an explicit final_price_cents override is definitive regardless of gate state.
  const isProvisional = listing.final_price_cents == null && !gateUnlocked
  // pricing.priceToMoveCents is always derived from the comps-based estimate, not from an
  // override -- showing it next to a final_price_cents override headline produces a
  // contradictory "$X to move" above an already-lower resolved price. Suppress it whenever an
  // override is in effect rather than deriving a second discount off the override.
  const showPriceToMove = listing.final_price_cents == null
  // The stored condition_delta/adjusted_price_cents columns on each sold comp reflect the
  // listing's condition at step3 gather-time -- recompute against the current condition here
  // too, or the drawer shows adjustment labels/prices that no longer support resolvedPriceCents
  // above (e.g. after a condition re-assessment flips condition_confirmed back to false).
  // _active-suffixed comps are excluded: they're live asking prices, not sold prices,
  // deliberately stored with condition_delta 'same' and adjusted_price_cents == sale_price_cents
  // verbatim (computeAdjustedPricing excludes them from the median entirely) -- condition-
  // adjusting them here would show a price that was never actually asked.
  const currentComps = comps.map((c) => {
    if (c.source.endsWith('_active')) return c
    const delta = conditionDelta(listing.condition ?? '', c.condition)
    return { ...c, condition_delta: delta, adjusted_price_cents: adjustForCondition(c.sale_price_cents, delta) }
  })

  async function savePriceOverride(finalPriceCents: number | null) {
    setSavingPriceOverride(true)
    try {
      const res = await fetch(`/api/listings/${listing.id}/price-override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalPriceCents }),
      })
      if (res.ok) {
        setPriceOverrideOpen(false)
        setPriceOverrideInput('')
        router.refresh()
      }
    } finally {
      setSavingPriceOverride(false)
    }
  }

  async function saveAuthPlan(updated: AuthStep[]) {
    setSaving(true)
    await fetch(`/api/listings/${listing.id}/auth-plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_plan: updated }),
    })
    setSaving(false)
  }

  function toggleStep(i: number) {
    const updated = authSteps.map((s, idx) =>
      idx === i ? { ...s, status: STEP_CYCLE[s.status] } : s
    )
    setAuthSteps(updated)
    void saveAuthPlan(updated)
  }

  function skipAll() {
    const updated = authSteps.map((s) => ({ ...s, status: 'done' as const }))
    setAuthSteps(updated)
    void saveAuthPlan(updated)
  }

  async function saveInclusions(updated: Inclusion[]) {
    const previous = inclusions
    savingInclusionsRef.current = true
    setInclusions(updated)
    try {
      const res = await fetch(`/api/listings/${listing.id}/inclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inclusions: updated }),
      })
      // The gate (isPricingGateUnlocked) and the premium-adjusted price both read this
      // optimistic state directly -- on a failed save, roll back rather than leaving an
      // unlocked gate / premium price displayed for inclusions that were never persisted.
      if (!res.ok) setInclusions(previous)
    } catch {
      setInclusions(previous)
    } finally {
      savingInclusionsRef.current = false
    }
  }

  function removeInclusion(i: number) {
    void saveInclusions(inclusions.filter((_, idx) => idx !== i))
  }

  function confirmInclusion(i: number) {
    void saveInclusions(inclusions.map((item, idx) => idx === i ? { ...item, confirmed: true } : item))
  }

  async function approveCondition() {
    savingConditionRef.current = true
    try {
      // isPricingGateUnlocked and the premium-adjusted price both read conditionConfirmed
      // directly -- without updating it here, a successful approval leaves the price
      // premium-free/provisional until the next 30s poll, even though the finalize route
      // already considers the gate unlocked server-side.
      const res = await fetch(`/api/listings/${listing.id}/condition`, { method: 'PATCH' })
      if (res.ok) setConditionConfirmed(true)
    } finally {
      savingConditionRef.current = false
    }
  }

  async function refreshPhotoPlan() {
    setRefreshingPlan(true)
    try {
      await fetch(`/api/listings/${listing.id}/photo-plan/refresh`, { method: 'POST' })
      router.refresh()
    } finally {
      setRefreshingPlan(false)
    }
  }

  function addInclusion(name?: string) {
    const item = (name ?? addInput).trim()
    if (!item) return
    const alreadyExists = inclusions.some((i) => i.item.trim().toLowerCase() === item.trim().toLowerCase())
    if (alreadyExists) {
      if (!name) setAddInput('')
      return
    }
    void saveInclusions([...inclusions, { item, source: 'manual', confirmed: true, notes: null }])
    if (!name) setAddInput('')
    addInputRef.current?.focus()
  }

  return (
    <>
      <div className="space-y-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-gray-600">{listing.sku ?? '—'}</span>
            <StatusBadge listing={listing} />
          </div>
          <h1 className="text-base font-semibold leading-snug text-gray-100">
            {listing.title ?? listing.brand ?? 'Untitled'}
          </h1>
          {listing.brand && listing.title && (
            <p className="text-xs text-gray-500">{listing.brand}</p>
          )}
        </div>

        {(
          // Was gated on resolvedPriceCents != null, which hid this whole card -- including
          // the price-override control -- for exactly the listings that need it most: zero
          // comps, no computed price, nothing for the pipeline to go on (e.g. a rare item
          // with no real market data). Always render the card; show a placeholder instead of
          // a dollar figure when there's genuinely no price yet.
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className={resolvedPriceCents != null ? 'text-xl font-bold text-emerald-400' : 'text-sm text-gray-600'}>
                {resolvedPriceCents != null ? formatPrice(resolvedPriceCents) : 'No price yet'}
              </span>
              {listing.confidence_score != null && (
                <span className="text-xs text-gray-500">{listing.confidence_score}% confidence</span>
              )}
            </div>
            {showPriceToMove && pricing.priceToMoveCents != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-amber-400 font-medium">{formatPrice(pricing.priceToMoveCents)}</span>
                <span className="text-xs text-gray-500">
                  to move{listing.price_to_move_discount_pct != null && <> · {Math.round(listing.price_to_move_discount_pct)}% off moves faster</>}
                </span>
              </div>
            )}
            {isProvisional && (
              <p className="text-[10px] text-amber-500/80">
                Provisional — will be refined once condition and inclusions are confirmed.
              </p>
            )}
            {priceOverrideOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={priceOverrideInput}
                  onChange={(e) => setPriceOverrideInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseFloat(priceOverrideInput)
                      if (!isNaN(n) && n > 0) void savePriceOverride(Math.round(n * 100))
                    }
                    if (e.key === 'Escape') setPriceOverrideOpen(false)
                  }}
                  placeholder="Override price"
                  inputMode="decimal"
                  className="w-24 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
                />
                <button
                  onClick={() => {
                    const n = parseFloat(priceOverrideInput)
                    if (!isNaN(n) && n > 0) void savePriceOverride(Math.round(n * 100))
                  }}
                  disabled={savingPriceOverride}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-900/60 text-emerald-300 hover:bg-emerald-900/80 transition-colors disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setPriceOverrideOpen(false)}
                  className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setPriceOverrideInput(listing.final_price_cents != null ? String(listing.final_price_cents / 100) : '')
                  setPriceOverrideOpen(true)
                }}
                className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                {listing.final_price_cents != null ? 'Edit override' : 'Override price'}
              </button>
            )}
            {listing.final_price_cents != null && !priceOverrideOpen && (
              <button
                onClick={() => void savePriceOverride(null)}
                disabled={savingPriceOverride}
                className="text-[10px] text-gray-600 hover:text-red-400 transition-colors ml-2 disabled:opacity-40"
              >
                Clear override
              </button>
            )}
            <button
              onClick={() => setEvidenceOpen(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {comps.length > 0 ? `View ${comps.length} comp${comps.length === 1 ? '' : 's'}` : 'No market comparables — add one'}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}

        <dl className="space-y-2">
          {listing.category && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Category</dt>
              <dd className="text-gray-300 capitalize">{listing.category}</dd>
            </div>
          )}
          {listing.condition && conditionConfirmed && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Condition</dt>
              <dd className="text-gray-300">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd>
            </div>
          )}
          {listing.condition_notes && conditionConfirmed && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Notes</dt>
              <dd className="text-gray-300 text-right max-w-[60%] leading-snug">{listing.condition_notes}</dd>
            </div>
          )}
        </dl>

        {listing.status === 'condition_gate'
          ? <ConditionReviewPanel listing={listing} />
          : listing.condition && !conditionConfirmed && (
            <section>
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Condition
              </h3>
              <div className="flex items-start gap-2 px-2 py-2 rounded bg-amber-950/40 border-l-2 border-amber-600">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-amber-300 font-medium">
                    {CONDITION_LABELS[listing.condition] ?? listing.condition}
                    <span className="text-amber-600/70 font-normal"> — recalculated from studio photos</span>
                  </p>
                  {listing.condition_notes && (
                    <p className="text-[10px] text-amber-600/80 mt-0.5 leading-snug">{listing.condition_notes}</p>
                  )}
                </div>
                <div className="flex-none flex gap-1.5 pt-0.5">
                  <button onClick={() => void approveCondition()} className="text-emerald-500 hover:text-emerald-400" title="Approve">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </section>
          )
        }

        {populatedMeasurements.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Measurements
            </h3>
            <dl className="space-y-2">
              {populatedMeasurements.map((field) => (
                <div key={field.key} className="flex justify-between text-xs">
                  <dt className="text-gray-600">{field.label}</dt>
                  <dd className="text-gray-300">
                    {formatMeasurementValue(field, (listing.measurements as Record<string, unknown>)[field.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {listing.status === 'finalizing' && <FinalizingChecklist listing={listing} />}

        {listing.description && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Description
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
            <p className="text-[10px] text-gray-600 mt-1">Ask the agent to rewrite if needed.</p>
          </section>
        )}

        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Progress
          </h3>
          <PipelineTimeline listing={listing} photos={photos} />
        </section>

        {listing.photo_plan && listing.photo_plan.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Photo Plan
              </h3>
              {inclusions.some((i) => !i.confirmed) && (
                <button
                  onClick={refreshPhotoPlan}
                  disabled={refreshingPlan}
                  className="text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-50"
                >
                  {refreshingPlan ? 'Refreshing…' : 'Refresh with current inclusions'}
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {listing.photo_plan.map((shot, idx) => {
                const order = shot.order ?? idx + 1
                const isHero = order === 1
                return (
                  <li key={shot.shot} className="flex items-start gap-2">
                    <span className={`mt-0.5 flex-none text-[10px] font-mono w-5 text-right leading-3.5 ${isHero ? 'text-amber-400 font-bold' : 'text-gray-600'}`}>
                      {order}
                    </span>
                    <span className={`mt-0.5 flex-none w-3.5 h-3.5 rounded border ${shot.required ? 'border-gray-600' : 'border-gray-700'}`} />
                    <div className="min-w-0">
                      <span className={`text-xs ${isHero ? 'text-amber-300 font-medium' : 'text-gray-300'}`}>{shot.shot}</span>
                      {isHero && <span className="ml-1 text-[10px] text-amber-500 font-semibold">HERO</span>}
                      {shot.required && !isHero && <span className="ml-1 text-[10px] text-orange-500">required</span>}
                      <p className="text-[10px] text-gray-600 leading-snug">{shot.description}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Inclusions
          </h3>
          <ul className="space-y-1.5">
            {inclusions.map((item, i) => {
              const suffix = item.tagState
                ? item.tagState === 'attached' ? '— still attached' : '— severed'
                : item.docSource === 'original' ? '— original (brand-issued)'
                : item.docSource === 'reseller' ? '— reseller-issued'
                : item.docSource === 'third_party' ? '— third-party verified'
                : item.source === 'manual' ? '— added by you'
                : null

              if (item.source === 'detected' && !item.confirmed) {
                return (
                  <li key={item.item} className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-950/40 border-l-2 border-amber-600">
                    <span className="text-xs flex-1 min-w-0 truncate text-amber-300">
                      {item.item}
                      {suffix && <span className="text-amber-600/70"> {suffix}</span>}
                    </span>
                    <button
                      onClick={() => confirmInclusion(i)}
                      className="flex-none text-emerald-500 hover:text-emerald-400"
                      title="Confirm"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeInclusion(i)}
                      className="flex-none text-gray-600 hover:text-red-400"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                )
              }

              return (
                <li key={item.item} className="flex items-center gap-2 px-2 py-1.5 rounded group">
                  <Check className={`w-3.5 h-3.5 flex-none ${item.source === 'manual' ? 'text-blue-400' : 'text-emerald-500'}`} />
                  <span className="text-xs flex-1 min-w-0 truncate text-gray-300">
                    {item.item}
                    {suffix && <span className={item.source === 'manual' ? 'text-blue-500/70' : 'text-gray-600'}> {suffix}</span>}
                    {item.notes && <span className="text-gray-600"> ({item.notes})</span>}
                  </span>
                  <button
                    className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-gray-400"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeInclusion(i)}
                    className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 hover:text-red-400"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              )
            })}
          </ul>

          {checklistCandidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 mb-2">
              {checklistCandidates.map((c) => (
                <button
                  key={c.item}
                  onClick={() => addInclusion(c.item)}
                  className="text-[10px] px-2 py-1 rounded-full border border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300 transition-colors"
                >
                  + {c.item}
                </button>
              ))}
            </div>
          )}

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
              onClick={() => addInclusion()}
              disabled={!addInput.trim()}
              className="flex-none text-gray-700 hover:text-emerald-400 disabled:opacity-30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {authSteps.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Authentication
              </h3>
              {doneCount < authSteps.length && (
                <button
                  onClick={skipAll}
                  disabled={saving}
                  className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-40"
                >
                  <SkipForward className="w-3 h-3" />
                  Skip — I know it&apos;s authentic
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {authSteps.map((step, i) => (
                <li key={step.step} className="flex items-start gap-2">
                  <button
                    onClick={() => toggleStep(i)}
                    disabled={saving}
                    className="mt-0.5 flex-none disabled:opacity-40"
                    title="Click to cycle: pending → done → failed"
                  >
                    <AuthStepIcon status={step.status} />
                  </button>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-300">{step.step}</p>
                    <p className="text-[10px] text-gray-600 leading-snug">{step.guidance}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-gray-600 mt-2">
              {doneCount}/{authSteps.length} complete
              {failedCount > 0 && ` · ${failedCount} failed`}
            </p>
          </section>
        )}

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

        {(() => {
          const flaggedPhotos = photos.filter(
            (p) => p.type === 'studio' && (p.photoroom_meta as { quality_failed?: boolean } | null)?.quality_failed
          )
          if (listing.agent_blocked && flaggedPhotos.length > 0) {
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
      </div>

      <EvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        listingId={listing.id}
        comps={currentComps}
        suggestedPriceCents={resolvedPriceCents}
        confidenceScore={listing.confidence_score}
        priceToMoveCents={showPriceToMove ? pricing.priceToMoveCents : null}
        priceToMoveDiscountPct={listing.price_to_move_discount_pct}
        retailPriceCents={listing.retail_price_cents}
        retailPriceSource={listing.retail_price_source}
        retailPriceUrl={listing.retail_price_url}
        retailPromoNote={listing.retail_promo_note}
        pricingMethodology={listing.pricing_methodology}
        priceHistory={priceHistory}
        platformPriceHistory={platformPriceHistory}
      />
    </>
  )
}
