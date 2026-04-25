'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyFieldProps {
  label: string
  value: string
  multiline?: boolean
}

export function CopyField({ label, value, multiline = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-800/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1">{label}</p>
        {multiline ? (
          <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed line-clamp-4">{value}</p>
        ) : (
          <p className="text-xs text-gray-300 truncate">{value}</p>
        )}
      </div>
      <button
        onClick={() => void copy()}
        className="flex-none mt-0.5 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
}
