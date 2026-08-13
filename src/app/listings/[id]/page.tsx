import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FieldsPanel } from '@/components/workspace/FieldsPanel'
import { AgentChat } from '@/components/workspace/AgentChat'
import { ArchiveButton } from '@/components/workspace/ArchiveButton'
import { PhotoSection } from '@/components/workspace/PhotoSection'
import { AutoRefresh } from '@/components/shared/AutoRefresh'
import type { Suggestion } from '@/components/workspace/SuggestedReplies'
import type { DetailGateContext, Listing, Photo, PricingComp, ListingPriceEvent } from '@/types/listings'
import { studioPhotosReady } from '@/lib/utils'
import { buildGenderGatePrompt, buildIdGatePrompt, synthesizeIdGateAnswer } from '@/lib/pipeline/gate-messages'

type WorkspaceContext = {
  firstMessage: string | null
  suggestions: Suggestion[] | null
  detailGateContext?: DetailGateContext
}

function ctx(firstMessage: string, suggestions: Suggestion[], detailGateContext?: DetailGateContext): WorkspaceContext {
  return { firstMessage, suggestions, detailGateContext }
}

const NO_CONTEXT: WorkspaceContext = { firstMessage: null, suggestions: null }

function inLoopContext(listing: Listing, photos: Photo[], hasHistory: boolean): WorkspaceContext {
  const studioPhotos = photos.filter((p) => p.type === 'studio')
  const hasStudio = studioPhotos.length > 0
  const allProcessed = studioPhotosReady(listing, photos)
  const pendingAuthCount = listing.auth_plan.filter((s) => s.status === 'pending').length
  const needsInclusions = listing.inclusions.length === 0

  if (!hasStudio) {
    return ctx(
      "The automated analysis is done. Upload your studio photos to get started — clear shots on a plain background work best.",
      [
        { label: 'Upload photos', openFilePicker: true },
        { label: 'What shots do I need?' },
        { label: 'Skip photos for now', message: "I'd like to skip uploading studio photos for now." },
      ]
    )
  }

  if (!allProcessed) {
    const photoWord = studioPhotos.length === 1 ? 'photo' : `${String(studioPhotos.length)} photos`
    return ctx(
      `Background removal is running on your ${photoWord}. Check back in a moment.`,
      [
        { label: "What's happening?", message: "What is background removal and why does it matter?" },
        { label: 'Skip background removal', message: "I'd like to skip background removal and keep the original photos." },
      ]
    )
  }

  if (!listing.photos_confirmed) {
    return ctx(
      listing.skip_background_removal
        ? "Background removal is off for this listing, so I've kept your original photos. Take a look and let me know if they look good to continue."
        : "Your photos have been processed — backgrounds removed. Take a look and let me know if they look good to continue.",
      [
        { label: 'Looks good ✓', message: 'The photos look great, ready to continue.', confirmPhotos: true },
        { label: 'There are problems', focusInput: true },
        listing.skip_background_removal
          ? { label: 'Turn on background removal', message: "I'd like to turn background removal back on for my photos." }
          : { label: 'Redo background removal', message: "Please redo the background removal on my photos." },
      ]
    )
  }

  if (pendingAuthCount > 0 || needsInclusions) {
    const parts: string[] = []
    if (pendingAuthCount > 0) {
      const stepWord = pendingAuthCount === 1 ? 'step' : 'steps'
      parts.push(`complete the authentication checklist (${pendingAuthCount} ${stepWord} remaining)`)
    }
    if (needsInclusions) parts.push("add what's included in the box")
    return ctx(
      `Almost there — please ${parts.join(' and ')}.`,
      [
        { label: 'All authenticated', message: 'All authentication steps are complete.' },
        { label: 'Skip auth', message: "I'd like to skip the authentication checklist." },
        { label: 'Inclusions complete', message: 'The inclusions list is complete.' },
        { label: 'Ask me about auth', message: 'Can you explain the authentication requirements?' },
      ]
    )
  }

  if (hasHistory) return NO_CONTEXT

  return ctx(
    "Review the title, description, and condition below — let me know if anything needs fixing, then you're ready to publish.",
    [
      { label: 'Everything looks good', message: 'The title, description, and condition all look correct.' },
      { label: 'Fix the title', message: 'The title needs to be updated.' },
      { label: 'Fix the description', message: 'The description needs work.' },
      { label: 'Wrong condition', message: 'The condition rating is incorrect.' },
    ]
  )
}

function idGateContext(listing: Listing): WorkspaceContext {
  return ctx(buildIdGatePrompt(listing), [
    {
      label: 'Yes, that\'s correct',
      confirmId: true,
      message: synthesizeIdGateAnswer({ confirmed: true, corrections: null, listing }),
    },
    { label: "Something's wrong", focusInput: true },
  ])
}

function genderGateContext(listing: Listing): WorkspaceContext {
  const { message, detailGateContext } = buildGenderGatePrompt(listing)

  if (!detailGateContext.categoryNeedsGender) {
    return ctx(message, [{ label: 'Enter measurements', focusInput: false }], detailGateContext)
  }

  return ctx(message, [
    { label: "Men's", confirmGender: 'mens', needsSize: false, message: "Men's" },
    { label: "Women's", confirmGender: 'womens', needsSize: false, message: "Women's" },
    { label: 'Unisex', confirmGender: 'unisex', message: 'Unisex' },
  ], detailGateContext)
}

function buildWorkspaceContext(listing: Listing, photos: Photo[], hasHistory: boolean): WorkspaceContext {
  if (listing.agent_blocked && listing.agent_blocked_reason) {
    return { firstMessage: listing.agent_blocked_reason, suggestions: null }
  }
  if (listing.status === 'published') {
    return { firstMessage: 'This listing is live. Ask me anything about it or use the agent to make edits.', suggestions: null }
  }
  if (listing.status === 'finalizing') {
    return { firstMessage: "This listing is being finalized. Let me know if you'd like any last changes before it goes live.", suggestions: null }
  }
  if (listing.status === 'id_gate') {
    return idGateContext(listing)
  }
  if (listing.status === 'gender_gate') {
    return genderGateContext(listing)
  }
  if (listing.status !== 'in_loop') {
    return { firstMessage: "I'm working on this listing. Ask me anything or check back shortly.", suggestions: null }
  }
  return inLoopContext(listing, photos, hasHistory)
}

export default async function WorkspacePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>
}>) {
  const { id } = await params
  const supabase = await createClient()

  const [listingResult, photosResult, compsResult, historyResult, priceHistoryResult] = await Promise.all([
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
    supabase
      .from('listing_price_events')
      .select('id, listing_id, event_type, price_cents, note, created_at')
      .eq('listing_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (listingResult.error || !listingResult.data) {
    notFound()
  }

  const listing = listingResult.data as unknown as Listing
  const photos = (photosResult.data ?? []) as unknown as Photo[]
  const comps = (compsResult.data ?? []) as unknown as PricingComp[]
  const history = historyResult.data ?? []
  const priceHistory = (priceHistoryResult.data ?? []) as unknown as ListingPriceEvent[]

  const hasHistory = history.length > 0
  const { firstMessage, suggestions, detailGateContext } = !hasHistory || listing.status === 'id_gate' || listing.status === 'gender_gate'
    ? buildWorkspaceContext(listing, photos, hasHistory)
    : { firstMessage: null, suggestions: null, detailGateContext: undefined }

  if (!hasHistory && firstMessage && !listing.agent_blocked && listing.status === 'in_loop') {
    const { error: firstMessageError } = await supabase.from('conversations').insert({
      listing_id: id,
      role: 'assistant',
      content: firstMessage,
      context_snapshot: null,
    })
    if (firstMessageError) {
      console.error(`Failed to persist in_loop first message for listing ${id}:`, firstMessageError.message)
    }
  }

  return (
    <div className="h-screen flex flex-col">
      <AutoRefresh active={listing.status !== 'published' && listing.status !== 'archived'} />
      <header className="flex-none flex items-center gap-3 px-6 py-3 border-b border-gray-800 bg-gray-950">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-400 font-mono">{listing.sku ?? listing.id.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-4">
          <ArchiveButton listingId={id} />
          <a href={`/listings/${id}/publish`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            Export →
          </a>
        </div>
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_1fr] xl:grid-cols-[3fr_2fr]">
        <div className="overflow-y-auto border-r border-gray-800">
          <div className="flex flex-col gap-6 p-6">
            <PhotoSection photos={photos} listingId={id} initialSkip={listing.skip_background_removal} />
            <FieldsPanel listing={listing} photos={photos} comps={comps} priceHistory={priceHistory} />
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
            pendingIdGate={listing.status === 'id_gate'}
            pendingGenderGate={listing.status === 'gender_gate'}
            detailGateContext={detailGateContext}
            firstMessage={firstMessage}
            suggestions={suggestions}
          />
        </div>
      </div>
    </div>
  )
}
