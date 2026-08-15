'use client'

import { useState } from 'react'
import type { Listing } from '@/types/listings'
import { checkTitleLengths } from '@/lib/pipeline/title-check'
import { needsBoxMeasurement, needsWeight } from '@/lib/pipeline/finalizing-checklist'

interface FinalizingChecklistProps {
  listing: Pick<Listing, 'id' | 'category' | 'inclusions' | 'measurements' | 'platform_fields'>
}

async function saveMeasurements(listingId: string, patch: Record<string, number>) {
  await fetch(`/api/listings/${listingId}/measurements`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function FinalizingChecklist({ listing }: Readonly<FinalizingChecklistProps>) {
  const [boxLength, setBoxLength] = useState('')
  const [boxWidth, setBoxWidth] = useState('')
  const [boxHeight, setBoxHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [savedBox, setSavedBox] = useState(false)
  const [savedWeight, setSavedWeight] = useState(false)

  const showBox = needsBoxMeasurement(listing) && !savedBox
  const showWeight = needsWeight(listing) && !savedWeight
  const titleWarnings = checkTitleLengths(listing.platform_fields)

  async function submitBox() {
    const length = parseFloat(boxLength)
    const width = parseFloat(boxWidth)
    const height = parseFloat(boxHeight)
    if (isNaN(length) || isNaN(width) || isNaN(height)) return
    await saveMeasurements(listing.id, { box_length_in: length, box_width_in: width, box_height_in: height })
    setSavedBox(true)
  }

  async function submitWeight() {
    const oz = parseFloat(weight)
    if (isNaN(oz)) return
    await saveMeasurements(listing.id, { weight_oz: oz })
    setSavedWeight(true)
  }

  if (!showBox && !showWeight && titleWarnings.length === 0) {
    return (
      <section>
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Finalizing Checklist
        </h3>
        <p className="text-xs text-emerald-400">Nothing outstanding.</p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Finalizing Checklist
      </h3>
      <div className="space-y-3">
        {titleWarnings.map((w) => (
          <p key={w.platform} className="text-xs text-amber-400">
            {w.platform} title is {w.currentLength} characters, over the {w.maxLength}-character limit.
          </p>
        ))}

        {showBox && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">Shipping box dimensions (original box included, in inches)</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder="L"
                value={boxLength}
                onChange={(e) => setBoxLength(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <input
                type="number"
                placeholder="W"
                value={boxWidth}
                onChange={(e) => setBoxWidth(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <input
                type="number"
                placeholder="H"
                value={boxHeight}
                onChange={(e) => setBoxHeight(e.target.value)}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <button
                onClick={() => void submitBox()}
                disabled={!boxLength || !boxWidth || !boxHeight}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {showWeight && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">Weight (oz)</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder="oz"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-20 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-gray-600 transition-colors"
              />
              <button
                onClick={() => void submitWeight()}
                disabled={!weight}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
