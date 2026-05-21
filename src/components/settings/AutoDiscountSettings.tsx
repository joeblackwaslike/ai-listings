'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AutoDiscountSettingsProps {
  initialEnabled: boolean
  initialPct: number
  initialIntervalDays: number
  initialFloorPct: number
}

async function patchSetting(patch: Record<string, boolean | number>) {
  await fetch('/api/settings/auto-discount', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function AutoDiscountSettings({
  initialEnabled,
  initialPct,
  initialIntervalDays,
  initialFloorPct,
}: AutoDiscountSettingsProps) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pct, setPct] = useState(String(initialPct))
  const [intervalDays, setIntervalDays] = useState(String(initialIntervalDays))
  const [floorPct, setFloorPct] = useState(String(initialFloorPct))

  const inputClass =
    'bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors w-full'

  async function handleToggle() {
    const next = !enabled
    setEnabled(next)
    await patchSetting({ enabled: next })
    router.refresh()
  }

  async function handleBlur(field: 'pct' | 'intervalDays' | 'floorPct', raw: string) {
    const num = parseFloat(raw)
    if (isNaN(num) || num <= 0) return
    await patchSetting({ [field]: num })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-200">Auto-discount enabled</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Automatically reduce prices on stale published listings
          </p>
        </div>
        <button
          onClick={() => void handleToggle()}
          className={`relative inline-flex h-5 w-9 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            enabled ? 'bg-emerald-500' : 'bg-gray-700'
          }`}
          role="switch"
          aria-checked={enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 rounded-xl border border-gray-800 px-5 py-4">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            When enabled, published listings are automatically discounted by {pct || '…'}% every{' '}
            {intervalDays || '…'} days until they reach {floorPct || '…'}% of the original price.
          </p>

          <div className="space-y-1.5">
            <label className="block text-[10px] text-gray-500">Discount % per interval</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              onBlur={() => void handleBlur('pct', pct)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] text-gray-500">Interval (days)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              onBlur={() => void handleBlur('intervalDays', intervalDays)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] text-gray-500">Floor % (never discount below this % of original)</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={floorPct}
              onChange={(e) => setFloorPct(e.target.value)}
              onBlur={() => void handleBlur('floorPct', floorPct)}
              className={inputClass}
            />
          </div>
        </div>
      )}
    </div>
  )
}
