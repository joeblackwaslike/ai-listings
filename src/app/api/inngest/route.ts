import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { resumePipeline } from '@/lib/inngest/functions/resume-pipeline'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'
import { syncPlatformNotifications } from '@/lib/inngest/functions/sync-platform-notifications'
import { syncPlatformMessages } from '@/lib/inngest/functions/sync-platform-messages'
import { syncPlatformOrders } from '@/lib/inngest/functions/sync-platform-orders'
import { textIntakePipeline } from '@/lib/inngest/functions/text-intake-pipeline'
import { autoDiscountCron } from '@/lib/inngest/functions/auto-discount-cron'
import { conditionReassessment } from '@/lib/inngest/functions/condition-reassessment'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    intakePipeline,
    retryStep,
    resumePipeline,
    photoQualityGate,
    syncPlatformNotifications,
    syncPlatformMessages,
    syncPlatformOrders,
    textIntakePipeline,
    autoDiscountCron,
    conditionReassessment,
  ],
})
