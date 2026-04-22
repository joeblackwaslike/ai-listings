import { eventType, Inngest, staticSchema } from 'inngest'

type PhotoUploadedData = {
  listingId: string
  photoUrl: string
  uploadedAt: string
}

type PipelineRetryStepData = {
  listingId: string
  step: number
}

export const photoUploaded = eventType('photo/uploaded', {
  schema: staticSchema<PhotoUploadedData>(),
})

export const pipelineRetryStep = eventType('pipeline/retry-step', {
  schema: staticSchema<PipelineRetryStepData>(),
})

export const inngest = new Inngest({
  id: 'ai-listings',
})
