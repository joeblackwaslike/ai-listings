'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleFieldsProps {
  label: string
  count: number
  children: ReactNode
}

export function CollapsibleFields({ label, count, children }: CollapsibleFieldsProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-1 px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {label} ({count})
      </button>
      <div id={panelId} hidden={!open} className="divide-y divide-gray-800/60 border-t border-gray-800">
        {children}
      </div>
    </div>
  )
}
