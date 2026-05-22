'use client'

import { useState } from 'react'
import { X, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { relativeDate, formatPrice } from '@/lib/utils'
import type { PricingComp, ListingPriceEvent } from '@/types/listings'

interface EvidenceDrawerProps {
  open: boolean
  onClose: () => void
  comps: PricingComp[]
  suggestedPriceCents: number | null
  confidenceScore: number | null
  priceToMoveCents?: number | null
  priceToMoveDiscountPct?: number | null
  retailPriceCents?: number | null
  retailPriceSource?: string | null
  retailPromoNote?: string | null
  pricingMethodology?: string | null
  priceHistory?: ListingPriceEvent[]
}

const SOURCE_LABELS: Record<string, string> = {
  ebay: 'eBay',
  poshmark: 'Poshmark',
  therealreal: 'TRR',
  google: 'Google',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  initial: 'Listed',
  manual_change: 'Repriced',
  auto_discount: 'Auto-discounted',
  relist: 'Relisted',
}

const DELTA_DISPLAY: Record<string, { label: string; color: string }> = {
  same: { label: 'same', color: 'text-gray-400' },
  better: { label: 'better', color: 'text-emerald-400' },
  worse: { label: 'worse', color: 'text-red-400' },
}

export function EvidenceDrawer({
  open,
  onClose,
  comps,
  suggestedPriceCents,
  confidenceScore,
  priceToMoveCents,
  priceToMoveDiscountPct,
  retailPriceCents,
  retailPriceSource,
  retailPromoNote,
  pricingMethodology,
  priceHistory,
}: EvidenceDrawerProps) {
  const [methodologyOpen, setMethodologyOpen] = useState(false)

  if (!open) return null

  const isUrl = (s: string) => /^https?:\/\//.test(s)

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
              <div className="text-right space-y-1">
                <div>
                  <p className="text-[10px] text-gray-600">Suggested</p>
                  <p className="text-sm font-semibold text-emerald-400">{formatPrice(suggestedPriceCents)}</p>
                </div>
                {priceToMoveCents != null && (
                  <div>
                    <p className="text-[10px] text-gray-600">Price to move</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {formatPrice(priceToMoveCents)}
                      {priceToMoveDiscountPct != null && (
                        <span className="text-[10px] font-normal text-gray-500 ml-1">
                          {priceToMoveDiscountPct}% off · moves faster
                        </span>
                      )}
                    </p>
                  </div>
                )}
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

          {priceHistory != null && priceHistory.length > 0 && (
            <div className="px-5 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Price History</p>
              <ul className="space-y-1">
                {priceHistory.map((event) => (
                  <li key={event.id} className="text-xs text-gray-400">
                    {formatPrice(event.price_cents)}
                    <span className="text-gray-600"> · {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</span>
                    <span className="text-gray-600"> · {relativeDate(event.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {retailPriceCents != null && (
            <div className="px-5 py-3 space-y-0.5">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Retail</p>
              <p className="text-xs text-gray-400">
                Retails new for{' '}
                <span className="text-gray-200 font-medium">{formatPrice(retailPriceCents)}</span>
                {retailPriceSource && (
                  <>
                    {' '}at{' '}
                    {isUrl(retailPriceSource) ? (
                      <a
                        href={retailPriceSource}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        {retailPriceSource}
                      </a>
                    ) : (
                      <span className="text-gray-300">{retailPriceSource}</span>
                    )}
                  </>
                )}
              </p>
              {retailPromoNote && (
                <p className="text-[10px] text-amber-500">{retailPromoNote}</p>
              )}
            </div>
          )}

          {pricingMethodology && (
            <div className="px-5 py-3">
              <button
                onClick={() => setMethodologyOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              >
                {methodologyOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Methodology
              </button>
              {methodologyOpen && (
                <div className="mt-2 text-xs text-gray-500 leading-relaxed prose prose-invert prose-xs max-w-none [&_h1]:text-[11px] [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-gray-400 [&_h2]:text-gray-400 [&_h3]:text-gray-400 [&_ul]:pl-3 [&_li]:my-0 [&_strong]:text-gray-400 [&_p]:my-1">
                  <ReactMarkdown>{pricingMethodology}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
