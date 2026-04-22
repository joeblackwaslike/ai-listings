import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [intakePipeline],
})
