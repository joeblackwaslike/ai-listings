'use client'

import { Check } from 'lucide-react'
import type { PhotoShot } from '@/types/listings'

interface PhotoShootTabProps {
  shots: PhotoShot[]
  onToggle: (shot: string) => void
  showRefresh: boolean
  refreshing: boolean
  onRefresh: () => void
}

function ShotBox({ shot, onToggle }: Readonly<{ shot: PhotoShot; onToggle: (shot: string) => void }>) {
  const base = 'mt-0.5 flex-none w-3.5 h-3.5 rounded flex items-center justify-center'
  if (shot.status === 'verified') {
    return (
      <span title="Verified by photo quality check" aria-label="Verified by photo quality check" className={`${base} bg-emerald-600 text-gray-950 cursor-default`}>
        <Check className="w-2.5 h-2.5" strokeWidth={3} />
      </span>
    )
  }
  const taken = shot.status === 'taken'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={taken}
      aria-label={shot.shot}
      onClick={() => onToggle(shot.shot)}
      title={taken ? 'You marked this shot taken — click to undo' : 'Mark shot taken'}
      className={taken ? `${base} bg-blue-500 text-gray-950` : `${base} border border-gray-600 hover:border-blue-400`}
    >
      {taken && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
    </button>
  )
}

/** Shot list with a three-state box per shot: empty, taken (blue, toggleable), verified (green, locked). */
export function PhotoShootTab({ shots, onToggle, showRefresh, refreshing, onRefresh }: Readonly<PhotoShootTabProps>) {
  return (
    <div>
      {showRefresh && (
        <div className="flex justify-end mb-2">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh with current inclusions'}
          </button>
        </div>
      )}
      {shots.length === 0 && <p className="text-[10px] text-gray-600">No photo plan yet.</p>}
      <ul className="space-y-1">
        {shots.map((shot, idx) => {
          const order = shot.order ?? idx + 1
          const isHero = order === 1
          const verified = shot.status === 'verified'
          const nameClass = verified ? 'text-gray-500' : isHero ? 'text-amber-300 font-medium' : 'text-gray-300'
          return (
            <li key={shot.shot} className="flex items-start gap-2 py-1">
              <span className={`mt-0.5 flex-none text-[10px] font-mono w-4 text-right ${isHero ? 'text-amber-400 font-bold' : 'text-gray-600'}`}>
                {order}
              </span>
              <ShotBox shot={shot} onToggle={onToggle} />
              <div className="min-w-0">
                <span className={`text-xs ${nameClass}`}>{shot.shot}</span>
                {isHero
                  ? <span className="ml-1 text-[10px] text-amber-500 font-semibold">HERO</span>
                  : shot.required
                  ? <span className="ml-1 text-[10px] text-orange-500">required</span>
                  : <span className="ml-1 text-[10px] text-gray-600">optional</span>}
                {verified && <span className="ml-1 text-[10px] text-emerald-600">verified</span>}
                <p className="text-[10px] text-gray-600 leading-snug">{shot.description}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
