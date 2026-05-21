'use client'

export interface Suggestion {
  label: string
  message?: string
  openFilePicker?: boolean
  confirmPhotos?: boolean
  confirmId?: boolean
  focusInput?: boolean
}

interface SuggestedRepliesProps {
  suggestions: Suggestion[]
  onSelect: (suggestion: Suggestion) => void
}

export function SuggestedReplies({ suggestions, onSelect }: Readonly<SuggestedRepliesProps>) {
  if (suggestions.length === 0) return null

  return (
    <div className="flex gap-2 flex-wrap pb-1">
      {suggestions.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect(s)}
          className="px-3 py-1.5 text-xs rounded-full border border-gray-700 text-gray-400 hover:border-emerald-500 hover:text-emerald-300 transition-colors whitespace-nowrap"
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
