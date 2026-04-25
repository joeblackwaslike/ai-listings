'use client'

import { X, ExternalLink } from 'lucide-react'
import { relativeDate, formatPrice } from '@/lib/utils'
import type { PricingComp } from '@/types/listings'

interface EvidenceDrawerProps {
  open: boolean
  onClose: () => void
  comps: PricingComp[]
  suggestedPriceCents: number | null
  confidenceScore: number | null
}

const SOURCE_LABELS: Record<string, string> = {
  ebay: 'eBay',
  poshmark: 'Poshmark',
  therealreal: 'TRR',
  google: 'Google',
}

const DELTA_DISPLAY: Record<string, { label: string; color: string }> = {
  same: { label: 'same', color: 'text-gray-400' },
  better: { label: 'better', color: 'text-emerald-400' },
  worse: { label: 'worse', color: 'text-red-400' },
}

export function EvidenceDrawer({ open, onClose, comps, suggestedPriceCents, confidenceScore }: EvidenceDrawerProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div>
            <h2 className="text-sm font-semibold">Pricing Evidence</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {comps.length} comp{comps.length !== 1 ? 's' : ''} ·{' '}
              {confidenceScore != null ? `${confidenceScore}% confidence` : 'no confidence score'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {suggestedPriceCents != null && (
              <div className="text-right">
                <p className="text-[10px] text-gray-600">Suggested</p>
                <p className="text-sm font-semibold text-emerald-400">{formatPrice(suggestedPriceCents)}</p>
              </div>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
          {comps.length === 0 ? (
            <p className="p-5 text-sm text-gray-600">No pricing comps available yet.</p>
          ) : (
            comps.map((comp) => {
              const delta = DELTA_DISPLAY[comp.condition_delta] ?? DELTA_DISPLAY.same
              const adjustedDiff = comp.adjusted_price_cents - comp.sale_price_cents
              return (
                <div key={comp.id} className="px-5 py-3 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 line-clamp-2 leading-snug">{comp.title}</p>
                    </div>
                    <div className="text-right flex-none">
                      <p className="text-xs font-semibold text-gray-100">{formatPrice(comp.adjusted_price_cents)}</p>
                      {adjustedDiff !== 0 && (
                        <p className="text-[10px] text-gray-600">
                          {adjustedDiff > 0 ? '+' : ''}{formatPrice(adjustedDiff)} adj
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {SOURCE_LABELS[comp.source] ?? comp.source}
                    </span>
                    <span className="text-[10px] text-gray-600">{comp.condition}</span>
                    <span className={`text-[10px] ${delta.color}`}>({delta.label} condition)</span>
                    <span className="text-[10px] text-gray-700">·</span>
                    <span className="text-[10px] text-gray-600">{relativeDate(comp.sold_at)}</span>
                    {comp.listing_url && (
                      <a
                        href={comp.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-gray-600 hover:text-gray-400"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
