import { inngest, photoUploaded } from '../client'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const intakePipeline = inngest.createFunction(
  {
    id: 'intake-pipeline',
    name: 'Intake Pipeline',
    triggers: [{ event: photoUploaded }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { listingId } = event.data

    await step.run('product-id', async () => {
      return { ok: true, listingId, step: 1 }
    })

    await step.run('vision-analysis', async () => {
      return { ok: true, step: 2 }
    })

    await step.run('pricing-research', async () => {
      return { ok: true, step: 3 }
    })

    await step.run('draft-and-process', async () => {
      return { ok: true, step: 4 }
    })

    await step.run('auth-plan', async () => {
      return { ok: true, step: 5 }
    })

    const supabase = getSupabaseAdmin()
    await supabase
      .from('listings')
      .update({ status: 'in_loop' })
      .eq('id', listingId)

    return { ok: true, listingId, status: 'in_loop' }
  }
)
