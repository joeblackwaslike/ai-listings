import { Check, Loader2, Circle } from 'lucide-react'
import type { Listing, Photo } from '@/types/listings'
import { buildPipelineSteps, type StepState } from '@/lib/pipeline-steps'

function StepIcon({ state }: Readonly<{ state: StepState }>) {
  if (state === 'done') {
    return (
      <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-emerald-400" />
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center">
        <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin" />
      </div>
    )
  }
  return (
    <div className="w-4 h-4 rounded-full flex items-center justify-center">
      <Circle className="w-3 h-3 text-gray-800" />
    </div>
  )
}

const labelClass: Record<StepState, string> = {
  done: 'text-gray-400',
  active: 'text-blue-300 font-medium',
  pending: 'text-gray-700',
}

const sublabelClass = { active: 'text-blue-400/70' }

export function PipelineTimeline({ listing, photos }: Readonly<{ listing: Listing; photos: Photo[] }>) {
  const steps = buildPipelineSteps(listing, photos)
  const liveLinks = Object.entries(listing.listing_urls ?? {}).filter(([, url]) => !!url)
  const isLive = listing.status === 'published' || listing.status === 'sold'

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const isActive = step.state === 'active'
        return (
          <div
            key={step.key}
            title={isActive ? undefined : step.sublabel}
            className={`flex gap-3 ${isActive ? 'bg-blue-950/30 rounded' : ''}`}
          >
            <div className="flex flex-col items-center">
              <div className="flex-none mt-0.5">
                <StepIcon state={step.state} />
              </div>
              {!isLast && (
                <div className={`w-px flex-1 my-1 ${step.state === 'done' ? 'bg-emerald-800/40' : 'bg-gray-800'}`} />
              )}
            </div>
            <div className="pb-3 min-w-0">
              <p className={`text-xs leading-tight ${labelClass[step.state]}`}>{step.label}</p>
              {isActive && (
                <p className={`text-[10px] leading-snug mt-0.5 ${sublabelClass.active}`}>{step.sublabel}</p>
              )}
            </div>
          </div>
        )
      })}
      {isLive && liveLinks.length > 0 && (
        <p className="pt-2 text-xs text-gray-400">
          Live:{' '}
          {liveLinks.map(([platform, url], i) => (
            <span key={platform}>
              {i > 0 && ', '}
              <a href={url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                {platform}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
