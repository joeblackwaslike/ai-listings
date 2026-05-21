import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'
import { studioPhotoProcess } from '@/lib/inngest/functions/studio-photo-process'
import { syncPlatformNotifications } from '@/lib/inngest/functions/sync-platform-notifications'
import { syncPlatformMessages } from '@/lib/inngest/functions/sync-platform-messages'
import { syncPlatformOrders } from '@/lib/inngest/functions/sync-platform-orders'
import { textIntakePipeline } from '@/lib/inngest/functions/text-intake-pipeline'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    intakePipeline,
    retryStep,
    photoQualityGate,
    studioPhotoProcess,
    syncPlatformNotifications,
    syncPlatformMessages,
    syncPlatformOrders,
    textIntakePipeline,
  ],
})
