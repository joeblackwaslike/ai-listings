'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, ExternalLink, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { relativeDate, formatPrice } from '@/lib/utils'
import type { PricingComp, ListingPriceEvent } from '@/types/listings'

interface EvidenceDrawerProps {
  open: boolean
  onClose: () => void
  listingId: string
  comps: PricingComp[]
  suggestedPriceCents: number | null
  confidenceScore: number | null
  priceToMoveCents?: number | null
  priceToMoveDiscountPct?: number | null
  retailPriceCents?: number | null
  retailPriceSource?: string | null
  retailPriceUrl?: string | null
  retailPromoNote?: string | null
  pricingMethodology?: string | null
  priceHistory?: ListingPriceEvent[]
}

const SOURCE_LABELS: Record<string, string> = {
  ebay: 'eBay',
  poshmark: 'Poshmark',
  therealreal: 'TRR',
  google: 'Google',
  manual: 'Manual',
  retail: 'Retail',
}

// Which underlying API/data provider produced the comp -- distinct from the platform
// (eBay, Poshmark, etc). Lets you see which data sources are actually working.
const PROVIDER_LABELS: Record<string, string> = {
  soldcomps: 'SoldComps',
  ebay_browse: 'eBay Browse API',
  serpapi: 'SerpAPI',
  poshmark_direct: 'Poshmark',
  reddit_claude: 'Reddit',
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
  listingId,
  comps,
  suggestedPriceCents,
  confidenceScore,
  priceToMoveCents,
  priceToMoveDiscountPct,
  retailPriceCents,
  retailPriceSource,
  retailPriceUrl,
  retailPromoNote,
  pricingMethodology,
  priceHistory,
}: EvidenceDrawerProps) {
  const router = useRouter()
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addActive, setAddActive] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!open) return null

  async function submitManualComp() {
    const priceDollars = parseFloat(addPrice)
    if (!addTitle.trim() || !Number.isFinite(priceDollars) || priceDollars <= 0) {
      setAddError('Title and a positive price are required.')
      return
    }
    setSubmitting(true)
    setAddError(null)
    try {
      const res = await fetch(`/api/listings/${listingId}/comps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: addTitle.trim(),
          salePriceCents: Math.round(priceDollars * 100),
          listingUrl: addUrl.trim() || null,
          isActive: addActive,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setAddError(body?.error ?? 'Failed to add comp.')
        return
      }
      setAddTitle('')
      setAddPrice('')
      setAddUrl('')
      setAddActive(false)
      setAddOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteManualComp(compId: string) {
    setDeletingId(compId)
    try {
      const res = await fetch(`/api/listings/${listingId}/comps`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compId }),
      })
      if (res.ok) router.refresh()
    } finally {
      setDeletingId(null)
    }
  }

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
              // Source strings carry a "_active" suffix for live-asking-price comps (e.g.
              // "ebay_active") -- that suffix isn't in SOURCE_LABELS, so it used to render
              // literally instead of a clean source name with a separate sold/active signal.
              const isActive = comp.source.endsWith('_active')
              const isRetail = comp.source === 'retail'
              const baseSource = isActive ? comp.source.slice(0, -'_active'.length) : comp.source
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
                      {SOURCE_LABELS[baseSource] ?? baseSource}
                    </span>
                    {comp.provider && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-500">
                        {PROVIDER_LABELS[comp.provider] ?? comp.provider}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        isRetail
                          ? 'bg-purple-900/60 text-purple-300'
                          : isActive
                            ? 'bg-blue-900/60 text-blue-300'
                            : 'bg-emerald-900/60 text-emerald-400'
                      }`}
                    >
                      {isRetail ? 'Retail' : isActive ? 'Active' : 'Sold'}
                    </span>
                    {/* Relevance scoring (LLM-judged match against brand/model/attributes) was
                        computed for every comp all along but never shown -- a comp with no
                        score at all (Claude call failed/timed out) is silently treated as
                        pass-through evidence for the sold-comp median (see step3's fail-open
                        comment), so flagging it as unverified lets the user judge it
                        themselves instead of trusting it blindly (2026-08-24, user report). */}
                    {comp.relevance_score === null ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-400">
                        Unverified
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-600">match {comp.relevance_score}/10</span>
                    )}
                    <span className="text-[10px] text-gray-600">{comp.condition}</span>
                    <span className={`text-[10px] ${delta.color}`}>({delta.label} condition)</span>
                    <span className="text-[10px] text-gray-700">·</span>
                    <span className="text-[10px] text-gray-600">{relativeDate(comp.sold_at)}</span>
                    {comp.listing_url && (
                      <a
                        href={comp.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={baseSource === 'manual' ? 'text-gray-600 hover:text-gray-400' : 'ml-auto text-gray-600 hover:text-gray-400'}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {baseSource === 'manual' && (
                      <button
                        onClick={() => void deleteManualComp(comp.id)}
                        disabled={deletingId === comp.id}
                        className="ml-auto text-gray-600 hover:text-red-400 disabled:opacity-40"
                        title="Remove this comp"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}

          <div className="px-5 py-3">
            {addOpen ? (
              <div className="space-y-2 rounded bg-gray-900/60 border border-gray-800 p-3">
                <input
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="Title (e.g. what you sold, or found elsewhere)"
                  className="w-full bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-1 transition-colors"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={addPrice}
                    onChange={(e) => setAddPrice(e.target.value)}
                    placeholder="Price"
                    inputMode="decimal"
                    className="w-24 bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-1 transition-colors"
                  />
                  <input
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    placeholder="URL (optional)"
                    className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-700 outline-none border-b border-gray-800 focus:border-gray-600 pb-1 transition-colors"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={addActive}
                    onChange={(e) => setAddActive(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  This is an active/asking price, not a sold price
                </label>
                {addError && <p className="text-[10px] text-red-400">{addError}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => void submitManualComp()}
                    disabled={submitting}
                    className="text-[10px] px-2.5 py-1 rounded bg-emerald-900/60 text-emerald-300 hover:bg-emerald-900/80 transition-colors disabled:opacity-40"
                  >
                    {submitting ? 'Adding…' : 'Add & recalculate'}
                  </button>
                  <button
                    onClick={() => { setAddOpen(false); setAddError(null) }}
                    className="text-[10px] px-2.5 py-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add a comp manually
              </button>
            )}
          </div>

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
                    {/* retailPriceUrl is the actual product page (2026-08-24) -- the old check
                        here tested whether retailPriceSource itself looked like a URL, which
                        it never did (it's a bare merchant name like "Nordstrom.com"), so this
                        never linked out despite looking like it should. */}
                    {retailPriceUrl ? (
                      <a
                        href={retailPriceUrl}
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
