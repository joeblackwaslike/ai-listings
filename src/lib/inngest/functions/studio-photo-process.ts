import { inngest } from '../client'
import type { StudioUploadedEvent } from '../client'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { getUserApiKeys } from '@/lib/user-api-keys'

export const studioPhotoProcess = inngest.createFunction(
  {
    id: 'studio-photo-process',
    name: 'Studio Photo Background Removal',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl } = (event as unknown as StudioUploadedEvent).data

    const supabase = getSupabaseAdmin()

    const apiKeys = await step.run('fetch-api-keys', async () => {
      const { data: listingRow } = await supabase
        .from('listings')
        .select('user_id')
        .eq('id', listingId)
        .single()
      return getUserApiKeys(listingRow?.user_id ?? null)
    })

    const storagePath = `studio/${listingId}/${photoId}-processed.png`
    await step.run('remove-background', () =>
      removeBackground(photoId, photoUrl, storagePath, apiKeys)
    )

    return { ok: true, listingId, photoId }
  }
)
