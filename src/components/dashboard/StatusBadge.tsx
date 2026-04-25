import type { ListingStatus } from '@/types/listings'

interface BadgeInput {
  status: ListingStatus
  agent_blocked: boolean
}

function getBadge(listing: BadgeInput): { label: string; className: string } {
  if (listing.status === 'intake' || listing.status === 'id_gate') {
    return { label: 'Processing', className: 'bg-gray-700/60 text-gray-400' }
  }
  if (listing.agent_blocked) {
    return { label: 'Needs you', className: 'bg-orange-900/60 text-orange-300' }
  }
  if (listing.status === 'in_loop') {
    return { label: 'Ready', className: 'bg-emerald-900/60 text-emerald-400' }
  }
  if (listing.status === 'finalizing') {
    return { label: 'Ready to publish', className: 'bg-blue-900/60 text-blue-300' }
  }
  if (listing.status === 'published') {
    return { label: 'Published', className: 'bg-purple-900/60 text-purple-300' }
  }
  return { label: 'Archived', className: 'bg-gray-800 text-gray-600' }
}

export function StatusBadge({ listing }: { listing: BadgeInput }) {
  const { label, className } = getBadge(listing)
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  )
}
