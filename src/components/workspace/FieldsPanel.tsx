'use client'

import { useState } from 'react'
import { ChevronRight, CheckCircle2, Circle, AlertCircle } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import { EvidenceDrawer } from './EvidenceDrawer'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import type { Listing, PricingComp } from '@/types/listings'

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

export function FieldsPanel({ listing, comps }: FieldsPanelProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const authSteps = listing.auth_plan ?? []
  const doneCount = authSteps.filter((s) => s.status === 'done').length
  const failedCount = authSteps.filter((s) => s.status === 'failed').length

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
          <div className="flex justify-between text-xs">
            <dt className="text-gray-600">Pipeline</dt>
            <dd className="text-gray-400">
              Step {listing.pipeline_step} of {listing.pipeline_total}
            </dd>
          </div>
        </dl>

        {authSteps.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Authentication
            </h3>
            <ul className="space-y-2">
              {authSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  {step.status === 'done' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 flex-none mt-0.5 text-emerald-500" />
                  ) : step.status === 'failed' ? (
                    <AlertCircle className="w-3.5 h-3.5 flex-none mt-0.5 text-red-500" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 flex-none mt-0.5 text-gray-700" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-gray-300">{step.step}</p>
                    <p className="text-[10px] text-gray-600 leading-snug">{step.guidance}</p>
                  </div>
                </li>
              ))}
            </ul>
            {authSteps.length > 0 && (
              <p className="text-[10px] text-gray-600 mt-2">
                {doneCount}/{authSteps.length} complete
                {failedCount > 0 && ` · ${failedCount} failed`}
              </p>
            )}
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
