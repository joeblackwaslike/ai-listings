import { inngest } from '../client'

export const photoQualityGate = inngest.createFunction(
  { id: 'photo-quality-gate', name: 'Photo Quality Gate', triggers: [{ event: 'studio/uploaded' }] },
  async () => ({ ok: true })
)
