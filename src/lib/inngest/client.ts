import { Inngest } from 'inngest'
import type { ConditionValue } from '@/types/listings'

export const inngest = new Inngest({
  id: 'ai-listings',
  ...(process.env.INNGEST_BASE_URL ? { baseUrl: process.env.INNGEST_BASE_URL } : {}),
})

// Typed event payload interfaces — used in function files to cast event.data
export interface PhotoUploadedEvent {
  name: 'photo/uploaded'
  data: {
    listingId: string
    photoUrl: string
    uploadedAt: string
  }
}

export interface PipelineRetryStepEvent {
  name: 'pipeline/retry-step'
  data: {
    listingId: string
    step: number
  }
}

export interface PipelineResumeEvent {
  name: 'pipeline/resume'
  data: {
    listingId: string
  }
}

export interface PipelineIdConfirmedEvent {
  name: 'pipeline/id-confirmed'
  data: {
    listingId: string
    confirmed: boolean
    corrections: string | null
  }
}

export interface PipelineGenderConfirmedEvent {
  name: 'pipeline/gender-confirmed'
  data: {
    listingId: string
    gender: string
    size: string | null
  }
}

export interface StudioUploadedEvent {
  name: 'studio/uploaded'
  data: {
    listingId: string
    photoId: string
    photoUrl: string
    replacesPhotoId?: string
  }
}

// Namespaced `listing/` rather than `pipeline/` because this event doesn't
// originate from a pipeline step — it's fired directly from an API route
// (confirm-photos/route.ts, a later task) when a user confirms processed
// studio photos, not from within the Inngest pipeline chain itself.
export interface ListingPhotosConfirmedEvent {
  name: 'listing/photos-confirmed'
  data: {
    listingId: string
  }
}

// Fired from the condition-gate UI after the user reviews the AI-assigned
// condition grade and submits their override (or confirms the original).
export interface ListingConditionConfirmedEvent {
  name: 'listing/condition-confirmed'
  data: {
    listingId: string
    condition: ConditionValue
    conditionNotes: string
    extraNotes: string
  }
}

export interface ListingRewriteRequestedEvent {
  name: 'listing/rewrite-requested'
  data: {
    listingId: string
    extraNotes: string
  }
}

export interface TextSubmittedEvent {
  name: 'text/submitted'
  data: {
    listingId: string
    productData: { description: string; brand?: string; imageUrl?: string }
    uploadedAt: string
  }
}
