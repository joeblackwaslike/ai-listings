import { Check, Loader2, Circle } from 'lucide-react'
import type { Listing, Photo } from '@/types/listings'

type StepState = 'done' | 'active' | 'pending'

interface Step {
  label: string
  sublabel?: string
  state: StepState
}

function automatedStepState(n: number, pipeline_step: number, pipeline_total: number, status: string): StepState {
  if (pipeline_step > n) return 'done'
  if (pipeline_step === n && status === 'in_loop' && n === pipeline_total) return 'done'
  if (pipeline_step === n) return 'active'
  return 'pending'
}

function buildAutomatedSteps(listing: Listing): Step[] {
  const { pipeline_step, pipeline_total, status, is_luxury } = listing
  const defs = is_luxury
    ? [
        { n: 1, label: 'Product ID', sublabel: 'Identified item from photo' },
        { n: 2, label: 'Vision Analysis', sublabel: 'Condition, brand, features' },
        { n: 3, label: 'Pricing Research', sublabel: 'Market comparables' },
        { n: 4, label: 'Draft Listing', sublabel: 'Description, tags, platform fields' },
        { n: 5, label: 'Auth Plan', sublabel: 'Authentication checklist' },
      ]
    : [
        { n: 1, label: 'Product ID', sublabel: 'Identified item from photo' },
        { n: 2, label: 'Vision Analysis', sublabel: 'Condition, brand, features' },
        { n: 3, label: 'Pricing Research', sublabel: 'Market comparables' },
        { n: 4, label: 'Draft Listing', sublabel: 'Description, tags, platform fields' },
      ]

  return defs.map(({ n, label, sublabel }) => ({
    label,
    sublabel,
    state: automatedStepState(n, pipeline_step, pipeline_total, status),
  }))
}

function humanStepState(conditions: { done: boolean; ready: boolean }): StepState {
  if (conditions.done) return 'done'
  if (conditions.ready) return 'active'
  return 'pending'
}

function buildHumanSteps(listing: Listing, photos: Photo[]): Step[] {
  const { status, is_luxury, auth_plan, photos_confirmed } = listing
  const isPublished = status === 'published'
  const studioPhotos = photos.filter((p) => p.type === 'studio')
  const hasStudio = studioPhotos.length > 0
  const allProcessed = hasStudio && studioPhotos.every((p) => p.processed_url)
  const authAllDone = !is_luxury || (auth_plan.length > 0 && auth_plan.every((s) => s.status === 'done'))

  return [
    {
      label: 'Upload Photos',
      sublabel: 'Studio shots and flat lays',
      state: humanStepState({ done: isPublished || hasStudio, ready: true }),
    },
    {
      label: 'Remove Backgrounds',
      sublabel: 'Auto-processed after upload',
      state: humanStepState({ done: isPublished || allProcessed, ready: hasStudio }),
    },
    {
      label: 'Confirm Photos',
      sublabel: 'Review processed images',
      state: humanStepState({ done: isPublished || photos_confirmed, ready: allProcessed }),
    },
    {
      label: 'Review Listing',
      sublabel: 'Title, description, condition',
      state: humanStepState({ done: isPublished, ready: photos_confirmed }),
    },
    {
      label: is_luxury ? 'Auth + Inclusions' : 'Inclusions',
      sublabel: is_luxury ? 'Checklist & box contents' : "Confirm what's in the box",
      state: humanStepState({ done: isPublished || (photos_confirmed && authAllDone), ready: photos_confirmed }),
    },
    {
      label: 'Publish',
      sublabel: 'Set final price and list',
      state: humanStepState({ done: isPublished, ready: false }),
    },
  ]
}

function buildSteps(listing: Listing, photos: Photo[]): Step[] {
  const automated = buildAutomatedSteps(listing)
  if (listing.pipeline_step < listing.pipeline_total) return automated
  return [...automated, ...buildHumanSteps(listing, photos)]
}

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

const sublabelClass: Record<StepState, string> = {
  done: 'text-gray-700',
  active: 'text-blue-400/70',
  pending: 'text-gray-800',
}

export function PipelineTimeline({ listing, photos }: Readonly<{ listing: Listing; photos: Photo[] }>) {
  const steps = buildSteps(listing, photos)

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        return (
          <div key={step.label} className="flex gap-3">
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
              {step.sublabel && (
                <p className={`text-[10px] leading-snug mt-0.5 ${sublabelClass[step.state]}`}>{step.sublabel}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
