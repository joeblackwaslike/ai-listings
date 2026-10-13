'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import { EvidenceDrawer } from './EvidenceDrawer'
import { adjustForCondition, computeAdjustedPricing, conditionDelta, isPricingGateUnlocked, resolveFinalPriceCents } from '@/lib/pipeline/pricing-adjust'
import type { Listing, PricingComp, AdjustedComp, ListingPriceEvent, PlatformPriceEvent } from '@/types/listings'

interface PriceCardProps {
  listing: Listing
  comps: PricingComp[]
  priceHistory: ListingPriceEvent[]
  platformPriceHistory: PlatformPriceEvent[]
}

/** Price, confidence, price-to-move, override controls and the comps EvidenceDrawer for one listing. */
export function PriceCard({ listing, comps, priceHistory, platformPriceHistory }: Readonly<PriceCardProps>) {
  const router = useRouter()
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [priceOverrideOpen, setPriceOverrideOpen] = useState(false)
  const [priceOverrideInput, setPriceOverrideInput] = useState('')
  const [savingPriceOverride, setSavingPriceOverride] = useState(false)

  // Reads the server-rendered listing. FieldsPanel calls router.refresh() after a successful
  // inclusions or condition save, so a just-changed gate reprices without waiting for the poll
  // (which is disabled entirely for published/archived listings).
  const inclusions = listing.inclusions ?? []
  const gateUnlocked = isPricingGateUnlocked({ condition_confirmed: listing.condition_confirmed, inclusions })
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
  // condition_delta and adjusted_price_cents are not stored in the DB — compute them here
  // against the current listing.condition so EvidenceDrawer always shows correct adjustments.
  // _active-suffixed comps are live asking prices, not sold prices — don't condition-adjust
  // them (computeAdjustedPricing excludes them from the median anyway).
  const currentComps: AdjustedComp[] = comps.map((c) => {
    if (c.source.endsWith('_active')) return { ...c, condition_delta: 'same' as const, adjusted_price_cents: c.sale_price_cents }
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

  return (
    <>
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
