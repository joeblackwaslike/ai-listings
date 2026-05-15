import { Check, Loader2, Circle } from 'lucide-react'
import type { Listing } from '@/types/listings'

interface Step {
  label: string
  sublabel?: string
  state: 'done' | 'active' | 'pending'
}

function buildSteps(listing: Listing): Step[] {
  const { pipeline_step, pipeline_total, status, is_luxury, auth_plan } = listing
  const automated = is_luxury
    ? [
        { n: 1, label: 'Product ID', sublabel: 'Identified item from photo' },
        { n: 2, label: 'Vision Analysis', sublabel: 'Condition, brand, features' },
        { n: 3, label: 'Pricing Research', sublabel: 'Market comparables' },
        { n: 4, label: 'Draft & Processing', sublabel: 'Listing draft, background removal' },
        { n: 5, label: 'Auth Plan', sublabel: 'Authentication checklist' },
      ]
    : [
        { n: 1, label: 'Product ID', sublabel: 'Identified item from photo' },
        { n: 2, label: 'Vision Analysis', sublabel: 'Condition, brand, features' },
        { n: 3, label: 'Pricing Research', sublabel: 'Market comparables' },
        { n: 4, label: 'Draft & Processing', sublabel: 'Listing draft, background removal' },
      ]

  const steps: Step[] = automated.map(({ n, label, sublabel }) => ({
    label,
    sublabel,
    state:
      pipeline_step > n ? 'done'
      : pipeline_step === n && status === 'in_loop' && n === pipeline_total ? 'done'
      : pipeline_step === n ? 'active'
      : 'pending',
  }))

  // Human steps — only shown once the pipeline finishes
  if (pipeline_step >= pipeline_total) {
    const authAllDone =
      !is_luxury ||
      (auth_plan.length > 0 && auth_plan.every((s) => s.status === 'done'))

    const reviewState: Step['state'] =
      status === 'published' ? 'done' : status === 'in_loop' ? 'active' : 'pending'

    steps.push({ label: 'Review Listing', sublabel: 'Title, description, condition', state: reviewState })

    if (is_luxury) {
      steps.push({
        label: 'Authentication',
        sublabel: 'Complete the checklist',
        state: status === 'published' ? 'done' : authAllDone ? 'done' : 'pending',
      })
    }

    steps.push({
      label: 'Publish',
      sublabel: 'Set final price and list',
      state: status === 'published' ? 'done' : 'pending',
    })
  }

  return steps
}

export function PipelineTimeline({ listing }: Readonly<{ listing: Listing }>) {
  const steps = buildSteps(listing)

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        return (
          <div key={step.label} className="flex gap-3">
            {/* spine */}
            <div className="flex flex-col items-center">
              <div className="flex-none mt-0.5">
                {step.state === 'done' ? (
                  <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  </div>
                ) : step.state === 'active' ? (
                  <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full flex items-center justify-center">
                    <Circle className="w-3 h-3 text-gray-800" />
                  </div>
                )}
              </div>
              {!isLast && (
                <div className={`w-px flex-1 my-1 ${step.state === 'done' ? 'bg-emerald-800/40' : 'bg-gray-800'}`} />
              )}
            </div>
            {/* text */}
            <div className={`pb-3 min-w-0 ${isLast ? '' : ''}`}>
              <p className={`text-xs leading-tight ${
                step.state === 'done' ? 'text-gray-400'
                : step.state === 'active' ? 'text-blue-300 font-medium'
                : 'text-gray-700'
              }`}>
                {step.label}
              </p>
              {step.sublabel && (
                <p className={`text-[10px] leading-snug mt-0.5 ${
                  step.state === 'done' ? 'text-gray-700'
                  : step.state === 'active' ? 'text-blue-400/70'
                  : 'text-gray-800'
                }`}>
                  {step.sublabel}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
