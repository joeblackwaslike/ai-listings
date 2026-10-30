import type { Listing, Photo } from '@/types/listings'
import { studioPhotosReady } from '@/lib/utils'

export type StepState = 'done' | 'active' | 'pending'

export interface PipelineStep {
  key: string
  label: string
  sublabel: string
  state: StepState
}

interface StepDef {
  key: string
  label: string
  sublabel: string
  done: boolean
}

function isQualityCheckDone(listing: Listing, studio: Photo[]): boolean {
  if (!listing.photos_confirmed || !listing.quality_checked_at || studio.length === 0) return false
  const checkedAt = Date.parse(listing.quality_checked_at)
  const newestUpload = Math.max(0, ...studio.map((p) => Date.parse(p.created_at)))
  const anyFailed = studio.some((p) => p.photoroom_meta?.quality_failed === true)
  return checkedAt >= newestUpload && !anyFailed
}

export function buildPipelineSteps(listing: Listing, photos: Photo[]): PipelineStep[] {
  const { status, pipeline_step: step, is_luxury } = listing
  const live = status === 'published' || status === 'sold'
  const studio = photos.filter((p) => p.type === 'studio')
  const isTextIntake = listing.intake_meta?.source === 'text'
  const inclusionsDone = listing.inclusions.every((i) => i.confirmed)
  const authDone = !is_luxury || listing.auth_plan.every((s) => s.status === 'done')

  const defs: (StepDef | null)[] = [
    { key: 'product_id', label: 'Product ID', sublabel: 'Identified item from photo', done: step >= 1 },
    { key: 'vision', label: 'Vision Analysis', sublabel: 'Condition, brand, inclusions, shot list', done: step >= 2 },
    isTextIntake
      ? null
      : { key: 'confirm_id', label: 'Confirm ID', sublabel: 'You confirm the identified item', done: step >= 2 && status !== 'id_gate' },
    { key: 'pricing', label: 'Pricing Research', sublabel: 'Market comparables', done: step >= 3 },
    { key: 'draft', label: 'Draft Listing', sublabel: 'Description, tags, platform fields', done: step >= 4 },
    is_luxury
      ? { key: 'auth_plan', label: 'Auth Plan', sublabel: 'Authentication checklist', done: step >= 5 }
      : null,
    {
      key: 'inclusions_auth',
      label: is_luxury ? 'Inclusions + Auth' : 'Inclusions',
      sublabel: is_luxury ? 'Confirm box contents, run checklist' : "Confirm what's in the box",
      done: inclusionsDone && authDone,
    },
    { key: 'photo_shoot', label: 'Photo Shoot', sublabel: 'Take and upload the planned shots', done: studio.length > 0 },
    {
      key: 'bg_removal',
      label: listing.skip_background_removal ? 'Keep Original Backgrounds' : 'Background Removal',
      sublabel: listing.skip_background_removal ? 'Background removal turned off' : 'Auto-processed after upload',
      done: studioPhotosReady(listing, photos),
    },
    { key: 'quality_check', label: 'Quality Check', sublabel: 'Scans for blur, exposure, framing', done: isQualityCheckDone(listing, studio) },
    { key: 'condition_review', label: 'Condition Review', sublabel: 'Grade confirmed from studio photos', done: listing.condition_confirmed === true },
    { key: 'copy_review', label: 'Copy Review', sublabel: 'Approve the rewritten description', done: listing.copy_approved_at != null },
    { key: 'finalize', label: 'Finalize', sublabel: 'Package size and weight', done: status === 'finalizing' || live },
    { key: 'publish', label: live ? 'Published' : 'Publish', sublabel: 'List on eBay and Poshmark', done: live },
  ]

  let activeTaken = false
  return defs
    .filter((d): d is StepDef => d !== null)
    .map(({ done, ...rest }) => {
      const isDone = live || done
      const state: StepState = isDone ? 'done' : activeTaken ? 'pending' : 'active'
      if (state === 'active') activeTaken = true
      return { ...rest, state }
    })
}
