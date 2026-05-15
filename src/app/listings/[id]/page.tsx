import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PhotoPanel } from '@/components/workspace/PhotoPanel'
import { FieldsPanel } from '@/components/workspace/FieldsPanel'
import { AgentChat } from '@/components/workspace/AgentChat'
import type { Listing, Photo, PricingComp } from '@/types/listings'

function inLoopNextSteps(listing: Listing, photos: Photo[]): string[] {
  const hasStudioPhotos = photos.some((p) => p.type === 'studio')
  const pendingAuthCount = listing.auth_plan.filter((s) => s.status === 'pending').length
  const steps: string[] = []
  if (pendingAuthCount > 0) steps.push(`• Complete the authentication checklist (${pendingAuthCount} steps remaining)`)
  if (!hasStudioPhotos) steps.push(`• Upload studio photos — use the photo icon in the chat to attach them`)
  if (steps.length === 0) steps.push(`• Review the title, description, and condition, then you're ready to publish`)
  return steps
}

function buildFirstMessage(listing: Listing, photos: Photo[]): string {
  if (listing.agent_blocked && listing.agent_blocked_reason) return listing.agent_blocked_reason
  if (listing.status === 'published') return `This listing is live. Ask me anything about it or use the agent to make edits.`
  if (listing.status === 'finalizing') return `This listing is being finalized. Let me know if you'd like any last changes before it goes live.`
  if (listing.status !== 'in_loop') return `I'm working on this listing. Ask me anything or check back shortly.`
  const steps = inLoopNextSteps(listing, photos)
  return [`The automated pipeline has finished — here's what's left before you can publish:`, ...steps].join('\n')
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [listingResult, photosResult, compsResult, historyResult] = await Promise.all([
    supabase.from('listings').select('*').eq('id', id).single(),
    supabase
      .from('photos')
      .select('*')
      .eq('listing_id', id)
      .order('display_order', { ascending: true }),
    supabase
      .from('pricing_comps')
      .select('*')
      .eq('listing_id', id)
      .order('adjusted_price_cents', { ascending: true }),
    supabase
      .from('conversations')
      .select('id, role, content, created_at')
      .eq('listing_id', id)
      .order('created_at', { ascending: true })
      .limit(30),
  ])

  if (listingResult.error || !listingResult.data) {
    notFound()
  }

  const listing = listingResult.data as unknown as Listing
  const photos = (photosResult.data ?? []) as unknown as Photo[]
  const comps = (compsResult.data ?? []) as unknown as PricingComp[]
  const history = historyResult.data ?? []

  const firstMessage = history.length === 0 ? buildFirstMessage(listing, photos) : null

  return (
    <div className="h-screen flex flex-col">
      <header className="flex-none flex items-center gap-3 px-6 py-3 border-b border-gray-800 bg-gray-950">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-400 font-mono">{listing.sku ?? listing.id.slice(0, 8)}</span>
        <a href={`/listings/${id}/publish`} className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Export →
        </a>
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_1fr] xl:grid-cols-[3fr_2fr]">
        <div className="overflow-y-auto border-r border-gray-800">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-6 p-6">
            <PhotoPanel
              photos={photos}
              photoplan={listing.photo_plan ?? []}
              inclusions={listing.inclusions ?? []}
              listingId={id}
            />
            <FieldsPanel listing={listing} comps={comps} />
          </div>
        </div>

        <div className="overflow-hidden">
          <AgentChat
            listingId={id}
            initialMessages={history.map((m) => ({
              id: m.id as string,
              role: m.role as string,
              content: m.content as string,
              created_at: m.created_at as string,
            }))}
            firstMessage={firstMessage}
          />
        </div>
      </div>
    </div>
  )
}
