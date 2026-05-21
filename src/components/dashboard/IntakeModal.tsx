'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface IntakeModalProps {
  onClose: () => void
  onTextSubmit: (entries: string[]) => void
}

export function IntakeModal({ onClose, onTextSubmit }: IntakeModalProps) {
  const [mode, setMode] = useState<'select' | 'describe'>('select')
  const [text, setText] = useState('')

  function handleSubmit() {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    onTextSubmit(lines)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog panel */}
      <div className="relative w-full max-w-md bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-100">Add item</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {/* Upload photos option */}
          <button
            onClick={onClose}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 transition-colors"
          >
            <p className="text-sm font-medium text-gray-100">Upload photos</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Drop or browse images — each photo creates one listing
            </p>
          </button>

          {/* Describe item option */}
          <button
            onClick={() => setMode(mode === 'describe' ? 'select' : 'describe')}
            className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
              mode === 'describe'
                ? 'border-emerald-700 bg-emerald-950/30'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800'
            }`}
          >
            <p className="text-sm font-medium text-gray-100">Describe item</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Enter text, a barcode, or a product URL
            </p>
          </button>

          {/* Textarea — shown when describe mode is active */}
          {mode === 'describe' && (
            <div className="space-y-3 pt-1">
              <textarea
                className="w-full h-36 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-gray-600 resize-none"
                placeholder={`One item per line. Supports:\n• Free-text description (e.g. "Casio F-91W watch, worn twice")\n• UPC/EAN barcode (e.g. 4971850714811)\n• Product page URL (e.g. https://...)`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <button
                onClick={handleSubmit}
                disabled={!text.trim()}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
              >
                Start →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
