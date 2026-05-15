import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'
import { studioPhotoProcess } from '@/lib/inngest/functions/studio-photo-process'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [intakePipeline, retryStep, photoQualityGate, studioPhotoProcess],
})
