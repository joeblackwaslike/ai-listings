'use client'

import { useState, useRef } from 'react'
import { ChevronRight, Check, CheckCircle2, Circle, AlertCircle, Plus, SkipForward, X } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import { EvidenceDrawer } from './EvidenceDrawer'
import { PipelineTimeline } from './PipelineTimeline'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import type { Listing, Photo, PricingComp, AuthStep, Inclusion, ListingPriceEvent } from '@/types/listings'

interface FieldsPanelProps {
  listing: Listing
  photos: Photo[]
  comps: PricingComp[]
  priceHistory: ListingPriceEvent[]
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

export function FieldsPanel({ listing, photos, comps, priceHistory }: Readonly<FieldsPanelProps>) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [authSteps, setAuthSteps] = useState<AuthStep[]>(listing.auth_plan ?? [])
  const [saving, setSaving] = useState(false)
  const [inclusions, setInclusions] = useState<Inclusion[]>(listing.inclusions ?? [])
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

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
    setInclusions(updated)
    await fetch(`/api/listings/${listing.id}/inclusions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inclusions: updated }),
    })
  }

  function removeInclusion(i: number) {
    void saveInclusions(inclusions.filter((_, idx) => idx !== i))
  }

  function addInclusion() {
    const name = addInput.trim()
    if (!name) return
    void saveInclusions([...inclusions, { item: name, included: true, notes: null }])
    setAddInput('')
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

        {listing.suggested_price_cents != null && (
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-emerald-400">
                {formatPrice(listing.suggested_price_cents)}
              </span>
              {listing.confidence_score != null && (
                <span className="text-xs text-gray-500">{listing.confidence_score}% confidence</span>
              )}
            </div>
            {comps.length > 0 ? (
              <button
                onClick={() => setEvidenceOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                View {comps.length} comp{comps.length === 1 ? '' : 's'}
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-gray-700">No market comparables found</span>
            )}
          </div>
        )}

        <dl className="space-y-2">
          {listing.category && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Category</dt>
              <dd className="text-gray-300 capitalize">{listing.category}</dd>
            </div>
          )}
          {listing.condition && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Condition</dt>
              <dd className="text-gray-300">{CONDITION_LABELS[listing.condition] ?? listing.condition}</dd>
            </div>
          )}
          {listing.condition_notes && (
            <div className="flex justify-between text-xs">
              <dt className="text-gray-600">Notes</dt>
              <dd className="text-gray-300 text-right max-w-[60%] leading-snug">{listing.condition_notes}</dd>
            </div>
          )}
        </dl>

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
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Photo Plan
            </h3>
            <ul className="space-y-2">
              {listing.photo_plan.map((shot) => (
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

        {listing.agent_blocked && listing.agent_blocked_reason && (
          <div className="rounded-lg border border-orange-800/50 bg-orange-950/30 px-3 py-2.5">
            <p className="text-xs font-medium text-orange-400 mb-0.5">Agent waiting</p>
            <p className="text-xs text-orange-300/80">{listing.agent_blocked_reason}</p>
          </div>
        )}
      </div>

      <EvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        comps={comps}
        suggestedPriceCents={listing.suggested_price_cents}
        confidenceScore={listing.confidence_score}
        priceToMoveCents={listing.price_to_move_cents}
        priceToMoveDiscountPct={listing.price_to_move_discount_pct}
        retailPriceCents={listing.retail_price_cents}
        retailPriceSource={listing.retail_price_source}
        retailPromoNote={listing.retail_promo_note}
        pricingMethodology={listing.pricing_methodology}
        priceHistory={priceHistory}
      />
    </>
  )
}
