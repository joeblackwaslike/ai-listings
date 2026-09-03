'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import type { Listing, ConditionValue } from '@/types/listings'

interface Props {
  listing: Listing
}

const GRADES: { value: ConditionValue; label: string; description: string }[] = [
  { value: 'new_with_tags',    label: 'New with tags',    description: 'Never used. Original tags attached. May be in original packaging.' },
  { value: 'new_without_tags', label: 'New without tags', description: 'Never used. Tags removed. No signs of wear or use.' },
  { value: 'like_new',         label: 'Like new',         description: 'Used once or twice. No visible flaws — looks brand new without tags.' },
  { value: 'very_good',        label: 'Very good',        description: 'Gently used. Minimal wear visible only on close inspection. No damage.' },
  { value: 'good',             label: 'Good',             description: 'Normal signs of use. Light scuffs, minor marks, or slight fading. No structural damage.' },
  { value: 'fair',             label: 'Fair',             description: 'Noticeable wear — scratches, marks, or staining visible. Fully functional.' },
  { value: 'poor',             label: 'Poor',             description: 'Heavy wear. Significant damage (cracks, tears, heavy staining) but still functional.' },
  { value: 'for_parts',        label: 'For parts',        description: 'Non-functional or severely damaged. Sold for parts or repair only.' },
]

export function ConditionReviewPanel({ listing }: Readonly<Props>) {
  const router = useRouter()
  const [selectedGrade, setSelectedGrade] = useState<ConditionValue | null>(listing.condition)
  const [conditionNotes, setConditionNotes] = useState(listing.condition_notes ?? '')
  const [extraNotes, setExtraNotes] = useState('')
  const [hoveredGrade, setHoveredGrade] = useState<ConditionValue | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form was already submitted — rewrite is in progress on the backend.
  // Show a holding state instead of the form so the user cannot double-submit.
  if (listing.condition_confirmed) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 text-center text-amber-300 text-sm">
        Rewriting copy — check back shortly.
      </div>
    )
  }

  async function handleSubmit() {
    if (!selectedGrade) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${listing.id}/confirm-condition`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition: selectedGrade,
          condition_notes: conditionNotes,
          extra_notes: extraNotes,
        }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to submit — please try again')
      }
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 space-y-4">
      <p className="text-sm font-medium text-amber-200">
        Review condition — recalculated from studio photos
      </p>

      <div className="flex flex-wrap gap-2">
        {GRADES.map(({ value, label }) => {
          const isSelected = selectedGrade === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedGrade(value)}
              onMouseEnter={() => setHoveredGrade(value)}
              onMouseLeave={() => setHoveredGrade(null)}
              disabled={loading}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                isSelected
                  ? 'bg-amber-900 text-amber-100 ring-2 ring-amber-400'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {(() => {
        const active = hoveredGrade ?? selectedGrade
        const grade = active ? GRADES.find(g => g.value === active) : null
        return grade ? (
          <p className="text-xs text-amber-300/80 bg-amber-950/30 border border-amber-800/40 rounded px-3 py-2 leading-relaxed">
            <span className="font-semibold text-amber-200">{grade.label}:</span> {grade.description}
          </p>
        ) : (
          <p className="text-xs text-gray-600 italic">Hover a grade to see its definition.</p>
        )
      })()}

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Condition notes</label>
        <textarea
          value={conditionNotes}
          onChange={(e) => setConditionNotes(e.target.value)}
          rows={4}
          disabled={loading}
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors resize-y disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Extra observations</label>
        <textarea
          value={extraNotes}
          onChange={(e) => setExtraNotes(e.target.value)}
          placeholder="What else did you notice? (factory tape on zipper, plastic still on hardware, receipt tucked in pocket, etc.)"
          rows={3}
          disabled={loading}
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors resize-y disabled:opacity-50"
        />
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={loading || !selectedGrade}
        className="w-full py-2 text-sm font-semibold rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Submitting…' : 'Rewrite & Confirm'}
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
