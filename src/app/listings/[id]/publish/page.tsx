import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SeoAudit } from '@/components/publish/SeoAudit'
import { PlatformTabs } from '@/components/publish/PlatformTabs'
import type { Listing } from '@/types/listings'

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    notFound()
  }

  const listing = data as unknown as Listing

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
          {listing.suggested_price_cents != null && (
            <p className="text-sm text-emerald-400 font-semibold mt-0.5">
              ${(listing.suggested_price_cents / 100).toFixed(0)} suggested
            </p>
          )}
        </div>

        <SeoAudit listing={listing} />
        <PlatformTabs listing={listing} />
      </div>
    </div>
  )
}
