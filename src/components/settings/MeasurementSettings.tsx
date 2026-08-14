'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface MeasurementSettingsProps {
  initialInputUnit: 'imperial' | 'metric'
}

async function patchInputUnit(inputUnit: 'imperial' | 'metric') {
  await fetch('/api/settings/measurements', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputUnit }),
  })
}

export function MeasurementSettings({ initialInputUnit }: MeasurementSettingsProps) {
  const router = useRouter()
  const [inputUnit, setInputUnit] = useState(initialInputUnit)

  async function select(next: 'imperial' | 'metric') {
    if (next === inputUnit) return
    setInputUnit(next)
    await patchInputUnit(next)
    router.refresh()
  }

  const optionClass = (active: boolean) =>
    `flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
      active
        ? 'border-emerald-500 text-emerald-300 bg-emerald-950'
        : 'border-gray-800 text-gray-400 hover:border-gray-700'
    }`

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-200">Measurement input unit</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => void select('imperial')} className={optionClass(inputUnit === 'imperial')}>
          Imperial (inches)
        </button>
        <button type="button" onClick={() => void select('metric')} className={optionClass(inputUnit === 'metric')}>
          Metric (mm)
        </button>
      </div>
      <p className="text-[11px] text-gray-600">
        {inputUnit === 'metric'
          ? 'The measurements form will ask for millimeters. Every listing still shows both units.'
          : 'The measurements form will ask for fractional inches. Every listing still shows both units.'}
      </p>
    </div>
  )
}
