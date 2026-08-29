import { inngest } from '../client'
import type { ListingConditionConfirmedEvent } from '../client'
import { loadApiKeys, runRewriteListing } from '@/lib/pipeline/rewrite-listing'

export const descriptionRewrite = inngest.createFunction(
  {
    id: 'description-rewrite',
    triggers: [{ event: 'listing/condition-confirmed' }],
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.listingId' },
  },
  async ({ event, step }) => {
    const { listingId, extraNotes } = (event as unknown as ListingConditionConfirmedEvent).data

    await step.run('rewrite-listing', async () => {
      const apiKeys = await loadApiKeys(listingId)
      return runRewriteListing(listingId, apiKeys, extraNotes)
    })

    return { ok: true, listingId }
  }
)
