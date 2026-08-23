'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import type { MeasurementField, Measurements } from '@/types/listings'
import { mmToInches, isPhysicalLengthField } from '@/lib/units'

export interface MeasurementFieldsHandle {
  submit: () => void
}

interface MeasurementFieldsProps {
  fields: MeasurementField[]
  inputUnit: 'imperial' | 'metric'
  onSubmit: (measurements: Partial<Measurements>) => void
  defaultValues?: Partial<Record<string, string | number>>
  // Label-above-input costs a full row per field -- fine on the workspace page's wide column,
  // but inside the dashboard card's cramped gate overlay it pushed Continue below the fold for
  // any category needing 2+ fields (width/height/depth, sneaker size) even though single-field
  // categories (ring size, chain length) fit -- had to scroll to find the button (ai-listings
  // dashboard report, 2026-08-23). Puts label and input on one row instead, opt-in so the
  // workspace page's layout is untouched.
  compact?: boolean
  // Sneakers' 6-field form is tall regardless of layout -- compact alone doesn't guarantee
  // Continue stays on-screen. The dashboard card hides this internal button and renders its
  // own outside the scrollable region instead (same fixed-footer pattern as the id-gate card),
  // triggering submission through the ref below.
  hideButton?: boolean
}

export const MeasurementFields = forwardRef<MeasurementFieldsHandle, MeasurementFieldsProps>(function MeasurementFields(
  { fields, inputUnit, onSubmit, defaultValues, compact = false, hideButton = false },
  ref
) {
  // Partial<Record<...>> so callers can omit keys, but internal state never needs to
  // distinguish "absent" from "undefined" — every read goes through `values[key] ?? ''`
  // or the `raw === undefined` guard in handleSubmit, so treating it as fully-populated
  // here is safe.
  const [values, setValues] = useState<Record<string, string | number>>(
    (defaultValues ?? {}) as Record<string, string | number>
  )

  function setField(key: string, value: string | number) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    const result: Partial<Measurements> = {}
    for (const field of fields) {
      const raw = values[field.key]
      if (raw === undefined || raw === '') continue
      if (field.useChips) {
        // chip value is stored as lowercase string matching Measurements type
        ;(result as Record<string, unknown>)[field.key] = String(raw).toLowerCase()
      } else if (field.textInput) {
        (result as Record<string, unknown>)[field.key] = String(raw)
      } else {
        const n = parseFloat(String(raw))
        if (!isNaN(n) && n >= 0) {
          (result as Record<string, unknown>)[field.key] =
            inputUnit === 'metric' && isPhysicalLengthField(field.key) ? mmToInches(n) : n
        }
      }
    }
    onSubmit(result)
  }

  useImperativeHandle(ref, () => ({ submit: handleSubmit }))

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-gray-700 bg-gray-900">
      {fields.map((field) => (
        <div key={field.key} className={compact ? 'flex flex-row items-center gap-2' : 'flex flex-col gap-1'}>
          <label
            htmlFor={`measurement-${field.key}`}
            className={compact ? 'w-20 flex-none text-xs text-gray-400' : 'text-xs text-gray-400'}
          >
            {field.label}
          </label>
          {field.useChips && field.chipOptions ? (
            <div className="flex gap-1.5 flex-wrap">
              {field.chipOptions.map((opt) => {
                const selected = String(values[field.key] ?? '').toLowerCase() === opt.toLowerCase()
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setField(field.key, opt)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      selected
                        ? 'border-emerald-500 text-emerald-300 bg-emerald-950'
                        : 'border-gray-700 text-gray-400 hover:border-emerald-500 hover:text-emerald-300'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          ) : field.textInput ? (
            <input
              id={`measurement-${field.key}`}
              type="text"
              placeholder={field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-40 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          ) : (
            <input
              id={`measurement-${field.key}`}
              type="number"
              min={0}
              step={inputUnit === 'metric' && isPhysicalLengthField(field.key) ? '1' : '0.5'}
              placeholder={inputUnit === 'metric' && isPhysicalLengthField(field.key) ? 'in mm' : field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-28 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          )}
        </div>
      ))}
      {!hideButton && (
        <button
          type="button"
          onClick={handleSubmit}
          className="self-start mt-1 px-4 py-1.5 text-xs rounded-full border border-emerald-600 text-emerald-300 hover:bg-emerald-950 transition-colors"
        >
          Continue →
        </button>
      )}
    </div>
  )
})
