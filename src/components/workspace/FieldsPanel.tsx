'use client'

import { useState } from 'react'
import { ChevronRight, CheckCircle2, Circle, AlertCircle, SkipForward } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import { EvidenceDrawer } from './EvidenceDrawer'
import { PipelineTimeline } from './PipelineTimeline'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import type { Listing, PricingComp, AuthStep } from '@/types/listings'

interface FieldsPanelProps {
  listing: Listing
  comps: PricingComp[]
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

export function FieldsPanel({ listing, comps }: FieldsPanelProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [authSteps, setAuthSteps] = useState<AuthStep[]>(listing.auth_plan ?? [])
  const [saving, setSaving] = useState(false)

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
    saveAuthPlan(updated)
  }

  function skipAll() {
    const updated = authSteps.map((s) => ({ ...s, status: 'done' as const }))
    setAuthSteps(updated)
    saveAuthPlan(updated)
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
            {comps.length > 0 && (
              <button
                onClick={() => setEvidenceOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                View {comps.length} pricing comp{comps.length !== 1 ? 's' : ''}
                <ChevronRight className="w-3 h-3" />
              </button>
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

        <section>
          <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Progress
          </h3>
          <PipelineTimeline listing={listing} />
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
                <li key={i} className="flex items-start gap-2">
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
      />
    </>
  )
}
