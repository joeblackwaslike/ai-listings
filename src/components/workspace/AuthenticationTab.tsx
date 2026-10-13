'use client'

import { CheckCircle2, Circle, AlertCircle, SkipForward } from 'lucide-react'
import type { AuthStep } from '@/types/listings'

interface AuthenticationTabProps {
  steps: AuthStep[]
  saving: boolean
  onToggle: (index: number) => void
  onSkipAll: () => void
}

function AuthStepIcon({ status }: Readonly<{ status: AuthStep['status'] }>) {
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />
  return <Circle className="w-3.5 h-3.5 text-gray-700 hover:text-gray-400 transition-colors" />
}

/** Authentication checklist: progress bar, click-to-cycle step status, guidance always visible. */
export function AuthenticationTab({ steps, saving, onToggle, onSkipAll }: Readonly<AuthenticationTabProps>) {
  const doneCount = steps.filter((s) => s.status === 'done').length
  const failedCount = steps.filter((s) => s.status === 'failed').length
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[10px] text-gray-500">
        <div
          className="flex-1 h-1 rounded bg-gray-800 overflow-hidden"
          role="progressbar"
          aria-label="Authentication progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
        >
          <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span>
          {doneCount}/{steps.length} complete
          {failedCount > 0 && <span className="text-red-400"> · {failedCount} failed</span>}
        </span>
      </div>
      {doneCount < steps.length && (
        <button
          onClick={onSkipAll}
          disabled={saving}
          className="flex items-center gap-1 mb-2 text-[10px] text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-40"
        >
          <SkipForward className="w-3 h-3" />
          Skip — I know it&apos;s authentic
        </button>
      )}
      <ul className="space-y-0.5">
        {steps.map((step, i) => (
          <li key={step.step} className="flex items-start gap-2 py-1">
            <button
              onClick={() => onToggle(i)}
              disabled={saving}
              className="mt-0.5 flex-none disabled:opacity-40"
              title="Click to cycle: pending → done → failed"
              aria-label={`${step.step}: ${step.status}. Click to change`}
            >
              <AuthStepIcon status={step.status} />
            </button>
            <div className="min-w-0">
              <span className="text-xs text-gray-300">{step.step}</span>
              <p className="text-[10px] text-gray-600 leading-snug">{step.guidance}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
