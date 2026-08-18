import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SeoAudit } from '@/components/publish/SeoAudit'
import { PlatformTabs } from '@/components/publish/PlatformTabs'
import { computeAdjustedPricing, isPricingGateUnlocked, resolveFinalPriceCents } from '@/lib/pipeline/pricing-adjust'
import type { Listing, PricingComp } from '@/types/listings'

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data, error }, { data: compRows, error: compsError }] = await Promise.all([
    supabase.from('listings').select('*').eq('id', id).single(),
    supabase.from('pricing_comps').select('*').eq('listing_id', id),
  ])

  if (error || !data) {
    notFound()
  }
  if (compsError) {
    // A failed comps fetch must not silently degrade to "no comps" -- that would display the
    // unpremiumed suggested_price_cents fallback while the independent post-to-ebay query
    // (which re-fetches comps itself) could still resolve the real comp/premium-adjusted price
    // moments later, so a seller could approve publishing at a different amount than shown here.
    throw new Error(`publish page: pricing_comps fetch failed — ${compsError.message}`)
  }

  const listing = data as unknown as Listing
  const comps = (compRows ?? []) as unknown as PricingComp[]
  const gateUnlocked = isPricingGateUnlocked(listing)
  const pricing = computeAdjustedPricing(listing, comps, { includePremiums: gateUnlocked })
  // The exact number buildUnifiedListingForEbay will publish -- not just computeAdjustedPricing's
  // raw result, which misses both a final_price_cents override and the suggested_price_cents
  // fallback for the zero-comps case.
  const resolvedPriceCents = resolveFinalPriceCents(listing, pricing)
  // Only "provisional" when we're actually displaying computeAdjustedPricing's gated result --
  // an explicit final_price_cents override is definitive regardless of gate state.
  const isProvisional = listing.final_price_cents == null && !gateUnlocked

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href={`/listings/${id}`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Workspace
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Publish Export</span>
        <span className="ml-auto text-xs font-mono text-gray-700">{listing.sku ?? id.slice(0, 8)}</span>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">
            {listing.title ?? listing.brand ?? 'Untitled'}
          </h1>
          {resolvedPriceCents != null && (
            <p className="text-sm text-emerald-400 font-semibold mt-0.5">
              ${(resolvedPriceCents / 100).toFixed(0)} suggested
              {isProvisional && (
                <span className="text-xs text-amber-500/80 font-normal"> — provisional, refines once condition and inclusions are confirmed</span>
              )}
            </p>
          )}
        </div>

        <SeoAudit listing={listing} />
        <PlatformTabs listing={listing} />
      </div>
    </div>
  )
}
