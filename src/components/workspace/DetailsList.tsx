import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getMeasurementFields } from '@/lib/utils'
import { formatDimensions, formatMeasurementValue, isDimensionKey } from '@/lib/units'
import { notableFeaturesOf } from '@/lib/pipeline/gate-messages'
import type { Listing } from '@/types/listings'

export const CONDITION_LABELS: Record<string, string> = {
  new_with_tags: 'New with Tags',
  new_without_tags: 'New without Tags',
  like_new: 'Like New',
  very_good: 'Very Good',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  for_parts: 'For Parts',
}

interface DetailsListProps {
  listing: Listing
  conditionConfirmed: boolean
}

/** Two-column label/value list: category, condition, notes, description, measurements. Only populated rows render. */
export function DetailsList({ listing, conditionConfirmed }: Readonly<DetailsListProps>) {
  const measurements = (listing.measurements ?? {}) as Record<string, unknown>
  const populatedMeasurements = getMeasurementFields(listing.category ?? '', listing.sub_type, notableFeaturesOf(listing.intake_meta))
    .filter((f) => measurements[f.key] !== undefined && measurements[f.key] !== null && measurements[f.key] !== '')
  const dimensions = formatDimensions(measurements, populatedMeasurements)
  const otherMeasurements = populatedMeasurements.filter((f) => !isDimensionKey(f.key))
  const conditionLabel = conditionConfirmed && listing.condition ? CONDITION_LABELS[listing.condition] ?? listing.condition : null
  const showNotes = conditionConfirmed && !!listing.condition_notes

  if (!listing.category && !conditionLabel && !showNotes && !listing.description && populatedMeasurements.length === 0) {
    return null
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Details</h3>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
        {listing.category && (
          <>
            <dt className="text-gray-600">Category</dt>
            <dd className="text-gray-300 capitalize">{listing.category.replaceAll('_', ' ')}</dd>
          </>
        )}
        {conditionLabel && (
          <>
            <dt className="text-gray-600">Condition</dt>
            <dd className="text-gray-300">{conditionLabel}</dd>
          </>
        )}
        {showNotes && (
          <>
            <dt className="text-gray-600">Condition notes</dt>
            <dd className="text-gray-300 leading-relaxed">{listing.condition_notes}</dd>
          </>
        )}
        {listing.description && (
          <>
            <dt className="text-gray-600">Description</dt>
            <dd>
              <div className="text-xs text-gray-300 leading-relaxed prose prose-invert prose-xs max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:text-gray-200 prose-hr:border-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{listing.description}</ReactMarkdown>
              </div>
              <p className="text-[10px] text-gray-600 mt-1">Ask the agent to rewrite if needed.</p>
            </dd>
          </>
        )}
        {populatedMeasurements.length > 0 && (
          <>
            <dt className="text-gray-600">Measurements</dt>
            <dd className="flex flex-wrap gap-x-5 gap-y-1 text-gray-300">
              {dimensions && (
                <span>
                  <span className="text-gray-600">Dimensions</span> {dimensions}
                </span>
              )}
              {otherMeasurements.map((field) => (
                <span key={field.key}>
                  <span className="text-gray-600">{field.label}</span> {formatMeasurementValue(field, measurements[field.key])}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}
