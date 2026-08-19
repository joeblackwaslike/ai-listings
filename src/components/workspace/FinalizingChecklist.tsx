'use client'

import { useState } from 'react'
import type { Listing } from '@/types/listings'
import { checkTitleLengths } from '@/lib/pipeline/title-check'
import { needsBoxMeasurement, needsWeight } from '@/lib/pipeline/finalizing-checklist'

interface FinalizingChecklistProps {
  listing: Pick<Listing, 'id' | 'category' | 'inclusions' | 'measurements' | 'platform_fields'>
}

async function saveMeasurements(listingId: string, patch: Record<string, number>): Promise<boolean> {
  try {
    const res = await fetch(`/api/listings/${listingId}/measurements`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return res.ok
  } catch {
    return false
  }
}

export function FinalizingChecklist({ listing }: Readonly<FinalizingChecklistProps>) {
  const [boxLength, setBoxLength] = useState('')
  const [boxWidth, setBoxWidth] = useState('')
  const [boxHeight, setBoxHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [savedBox, setSavedBox] = useState(false)
  const [savedWeight, setSavedWeight] = useState(false)
  const [boxPending, setBoxPending] = useState(false)
  const [boxError, setBoxError] = useState<string | null>(null)
  const [weightPending, setWeightPending] = useState(false)
  const [weightError, setWeightError] = useState<string | null>(null)

  const showBox = needsBoxMeasurement(listing) && !savedBox
  const showWeight = needsWeight(listing) && !savedWeight
  const titleWarnings = checkTitleLengths(listing.platform_fields)

  async function submitBox() {
    const length = parseFloat(boxLength)
    const width = parseFloat(boxWidth)
    const height = parseFloat(boxHeight)
    if (isNaN(length) || isNaN(width) || isNaN(height) || length <= 0 || width <= 0 || height <= 0) {
      setBoxError('Enter positive numbers for all three dimensions.')
      return
    }
    setBoxPending(true)
    setBoxError(null)
    const ok = await saveMeasurements(listing.id, { box_length_in: length, box_width_in: width, box_height_in: height })
    setBoxPending(false)
    if (ok) {
      setSavedBox(true)
    } else {
      setBoxError('Save failed — check the values and try again.')
    }
  }

  async function submitWeight() {
    const oz = parseFloat(weight)
    if (isNaN(oz) || oz <= 0) {
      setWeightError('Enter a positive number.')
      return
    }
    setWeightPending(true)
    setWeightError(null)
    const ok = await saveMeasurements(listing.id, { weight_oz: oz })
    setWeightPending(false)
    if (ok) {
      setSavedWeight(true)
    } else {
      setWeightError('Save failed — check the value and try again.')
    }
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
                disabled={!boxLength || !boxWidth || !boxHeight || boxPending}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
            {boxError && <p className="text-xs text-red-400">{boxError}</p>}
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
                disabled={!weight || weightPending}
                className="text-xs text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
            {weightError && <p className="text-xs text-red-400">{weightError}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
