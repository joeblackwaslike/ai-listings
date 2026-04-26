'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

interface ApiKeyRowProps {
  provider: string
  label: string
  placeholder: string
  maskedValue: string | null
}

export function ApiKeyRow({ provider, label, placeholder, maskedValue }: ApiKeyRowProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    if (!value.trim()) return
    setSaving(true)
    try {
      await fetch('/api/settings/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: value.trim() }),
      })
      setValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="w-28 flex-none">
        <p className="text-xs font-semibold text-gray-300">{label}</p>
        <p className="text-[10px] text-gray-600 font-mono mt-0.5">
          {maskedValue ?? 'Not set'}
        </p>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors font-mono"
      />
      <button
        onClick={() => void save()}
        disabled={!value.trim() || saving}
        className="flex-none flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {saved ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}
