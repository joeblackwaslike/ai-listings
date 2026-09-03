import type { ListingStatus } from '@/types/listings'

interface BadgeInput {
  status: ListingStatus
  agent_blocked: boolean
  pipeline_step: number
  pipeline_total: number
}

function getBadge(listing: BadgeInput): { label: string; className: string } {
  if (listing.status === 'intake' || listing.status === 'id_gate') {
    return { label: 'Processing', className: 'bg-gray-700/60 text-gray-400' }
  }
  if (listing.status === 'gender_gate') {
    return { label: 'Needs details', className: 'bg-amber-900/60 text-amber-300' }
  }
  if (listing.agent_blocked) {
    return { label: 'Needs you', className: 'bg-orange-900/60 text-orange-300' }
  }
  if (listing.status === 'in_loop') {
    // 'in_loop' covers the entire remaining pipeline after the gender/measurement gate --
    // pricing research, draft listing, photo processing, auth planning -- not just the
    // genuinely-idle "ready for you to review" state at the end. pipeline_step reaches
    // pipeline_total (set by step4a/step5, see step*.ts) only once every automated step has
    // actually finished; anything short of that was showing "Ready" on listings still
    // mid-pricing-research (dashboard report, 2026-08-21).
    if (listing.pipeline_step < listing.pipeline_total) {
      return { label: 'Processing', className: 'bg-gray-700/60 text-gray-400' }
    }
    return { label: 'Ready', className: 'bg-emerald-900/60 text-emerald-400' }
  }
  if (listing.status === 'condition_gate') {
    return { label: 'Check condition', className: 'bg-amber-900/60 text-amber-300' }
  }
  if (listing.status === 'copy_review') {
    return { label: 'Review copy', className: 'bg-amber-900/60 text-amber-300' }
  }
  if (listing.status === 'finalizing') {
    return { label: 'Ready to publish', className: 'bg-blue-900/60 text-blue-300' }
  }
  if (listing.status === 'published') {
    return { label: 'Published', className: 'bg-purple-900/60 text-purple-300' }
  }
  if (listing.status === 'archived') {
    return { label: 'Archived', className: 'bg-gray-800 text-gray-600' }
  }
  // Exhaustiveness guard — a future ListingStatus value not handled above will fail to compile
  // here instead of silently falling through to a misleading label (this exact bug, for
  // gender_gate, is what prompted adding this).
  const exhaustive: never = listing.status
  throw new Error(`StatusBadge: unhandled listing status ${exhaustive as string}`)
}

export function StatusBadge({ listing }: { listing: BadgeInput }) {
  const { label, className } = getBadge(listing)
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  )
}
