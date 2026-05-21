import { createClient } from '@/lib/supabase/server'
import { ListingsGrid } from '@/components/dashboard/ListingsGrid'
import type { ListingWithCover } from '@/components/dashboard/ListingCard'
import { NotificationBell } from '@/components/layout/NotificationBell'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: listings } = await supabase
    .from('listings')
    .select('id, sku, status, title, brand, category, condition, condition_notes, intake_meta, suggested_price_cents, agent_blocked, agent_blocked_reason, pipeline_step, pipeline_total')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(100)

  const listingIds = (listings ?? []).map((l) => l.id)

  const { data: photos } = listingIds.length > 0
    ? await supabase
        .from('photos')
        .select('listing_id, raw_url, processed_url, type')
        .in('listing_id', listingIds)
        .order('display_order', { ascending: true })
    : { data: [] }

  const coverByListing = new Map<string, { raw_url: string; processed_url: string | null }>()
  for (const p of photos ?? []) {
    const existing = coverByListing.get(p.listing_id as string)
    if (!existing || (p.processed_url && !existing.processed_url)) {
      coverByListing.set(p.listing_id as string, {
        raw_url: p.raw_url as string,
        processed_url: p.processed_url as string | null,
      })
    }
  }

  const listingsWithCovers: ListingWithCover[] = (listings ?? []).map((l) => ({
    ...l,
    agent_blocked: (l.agent_blocked as boolean) ?? false,
    coverPhoto: coverByListing.get(l.id) ?? undefined,
  }))

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">AI Listings</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{listingsWithCovers.length} listings</span>
          <NotificationBell />
        </div>
      </div>
      <ListingsGrid initialListings={listingsWithCovers} />
    </main>
  )
}
