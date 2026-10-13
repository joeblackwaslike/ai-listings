'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { inclusionOptions } from '@/lib/inclusion-options'
import type { Listing } from '@/types/listings'

interface InclusionComboboxProps {
  present: string[]
  category: string
  subType: Listing['sub_type']
  onAdd: (item: string) => void
}

function Highlighted({ text, query }: Readonly<{ text: string; query: string }>) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <b className="text-gray-100">{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  )
}

/** ARIA combobox for adding an inclusion: common picks on focus, filtered known items while typing, free text last. */
export function InclusionCombobox({ present, category, subType, onAdd }: Readonly<InclusionComboboxProps>) {
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const options = useMemo(
    () => inclusionOptions(query, present, category, subType),
    [query, present, category, subType]
  )
  const expanded = open && options.length > 0
  const trimmed = query.trim()
  const active = Math.min(highlight, options.length - 1)

  useEffect(() => {
    if (expanded) document.getElementById(`${listboxId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [expanded, active, listboxId])

  function pick(index: number) {
    const option = options[index]
    if (!option) return
    onAdd(option.value)
    setQuery('')
    setHighlight(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (options.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + step + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (expanded) pick(active)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative mt-3">
      <input
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listboxId}-${active}` : undefined}
        aria-label="Add inclusion"
        autoComplete="off"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Add inclusion…"
        className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-gray-600"
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Inclusion suggestions"
        hidden={!expanded}
        className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border border-gray-700 bg-gray-900 shadow-xl py-1"
      >
        {!trimmed && (
          <li role="presentation" className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-gray-600">
            Common for {category ? category.replaceAll('_', ' ') : 'this item'}
          </li>
        )}
        {options.map((option, i) => (
          <li
            key={option.custom ? `custom:${option.value}` : option.value}
            id={`${listboxId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => { e.preventDefault(); pick(i) }}
            onMouseEnter={() => setHighlight(i)}
            className={`px-2 py-1.5 text-xs cursor-pointer ${i === active ? 'bg-gray-800 text-gray-100' : 'text-gray-400'} ${option.custom ? 'italic' : ''}`}
          >
            {option.custom ? `Add “${option.value}”` : <Highlighted text={option.value} query={trimmed} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
