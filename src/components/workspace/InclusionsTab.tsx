'use client'

import { Check, X } from 'lucide-react'
import { InclusionCombobox } from './InclusionCombobox'
import type { Inclusion, Listing } from '@/types/listings'

interface InclusionsTabProps {
  inclusions: Inclusion[]
  category: string
  subType: Listing['sub_type']
  onAdd: (item: string) => void
  onConfirm: (index: number) => void
  onRemove: (index: number) => void
}

function inclusionSuffix(item: Inclusion): string | null {
  if (item.tagState) return item.tagState === 'attached' ? '— still attached' : '— severed'
  if (item.docSource === 'original') return '— original (brand-issued)'
  if (item.docSource === 'reseller') return '— reseller-issued'
  if (item.docSource === 'third_party') return '— third-party verified'
  if (item.source === 'manual') return '— added by you'
  return null
}

/** Inclusions list (amber = detected and unconfirmed, blue = added by you, green = confirmed) plus the add combobox. */
export function InclusionsTab({ inclusions, category, subType, onAdd, onConfirm, onRemove }: Readonly<InclusionsTabProps>) {
  return (
    <div>
      {inclusions.length === 0 && <p className="text-[10px] text-gray-600 px-2">No inclusions yet.</p>}
      <ul className="space-y-1">
        {inclusions.map((item, i) => {
          const suffix = inclusionSuffix(item)

          if (item.source === 'detected' && !item.confirmed) {
            return (
              <li key={item.item} className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-950/40 border-l-2 border-amber-600">
                <span className="text-xs flex-1 min-w-0 truncate text-amber-300">
                  {item.item}
                  {suffix && <span className="text-amber-600/70"> {suffix}</span>}
                </span>
                <button onClick={() => onConfirm(i)} className="flex-none text-emerald-500 hover:text-emerald-400" title="Confirm" aria-label={`Confirm ${item.item}`}>
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onRemove(i)} className="flex-none text-gray-600 hover:text-red-400" title="Remove" aria-label={`Remove ${item.item}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            )
          }

          const manual = item.source === 'manual'
          return (
            <li key={item.item} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-900/60">
              <Check className={`w-3.5 h-3.5 flex-none ${manual ? 'text-blue-400' : 'text-emerald-500'}`} />
              <span className="text-xs flex-1 min-w-0 truncate text-gray-300">
                {item.item}
                {suffix && <span className={manual ? 'text-blue-500/70' : 'text-gray-600'}> {suffix}</span>}
                {item.notes && <span className="text-gray-600"> ({item.notes})</span>}
              </span>
              <button
                onClick={() => onRemove(i)}
                className="flex-none opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity text-gray-700 hover:text-red-400"
                title="Remove"
                aria-label={`Remove ${item.item}`}
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          )
        })}
      </ul>
      <InclusionCombobox present={inclusions.map((i) => i.item)} category={category} subType={subType} onAdd={onAdd} />
    </div>
  )
}
