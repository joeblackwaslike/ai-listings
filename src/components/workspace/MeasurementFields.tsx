'use client'

import { useState } from 'react'
import type { MeasurementField, Measurements } from '@/types/listings'

interface MeasurementFieldsProps {
  fields: MeasurementField[]
  onSubmit: (measurements: Partial<Measurements>) => void
}

export function MeasurementFields({ fields, onSubmit }: Readonly<MeasurementFieldsProps>) {
  const [values, setValues] = useState<Record<string, string | number>>({})

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
      } else {
        const n = parseFloat(String(raw))
        if (!isNaN(n)) (result as Record<string, unknown>)[field.key] = n
      }
    }
    onSubmit(result)
  }

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-gray-700 bg-gray-900">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">{field.label}</label>
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
          ) : (
            <input
              type="number"
              step="0.5"
              placeholder={field.hint}
              value={String(values[field.key] ?? '')}
              onChange={(e) => setField(field.key, e.target.value)}
              className="w-28 px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={handleSubmit}
        className="self-start mt-1 px-4 py-1.5 text-xs rounded-full border border-emerald-600 text-emerald-300 hover:bg-emerald-950 transition-colors"
      >
        Continue →
      </button>
    </div>
  )
}
