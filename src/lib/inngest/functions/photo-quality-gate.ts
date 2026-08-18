import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import { inngest } from '../client'
import type { StudioUploadedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { toPublicUrl } from '@/lib/pipeline/to-public-url'
import { removeBackground } from '@/lib/pipeline/remove-background'
import { getUserApiKeys } from '@/lib/user-api-keys'
import { getInclusionChecklist, mergeDetectedInclusions } from '@/lib/inclusions'
import { detectInclusionsFromPhoto } from '@/lib/pipeline/step2-vision-analysis'
import type { Inclusion } from '@/types/listings'

interface QualityOutput {
  passed: boolean
  issues: string[]
  verdict: string
}

async function checkPhotoQuality(photoUrl: string): Promise<QualityOutput> {
  const publicUrl = await toPublicUrl(photoUrl)

  try {
    return await runStructured<QualityOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 512,
      image: { url: publicUrl },
      apiKey: process.env.ANTHROPIC_API_KEY,
      toolName: 'quality_check',
      toolDescription: 'Evaluate photo quality for a resale listing',
      prompt: `Evaluate this product photo for resale listing quality.

Check for:
1. Blur or motion blur — is the subject sharp?
2. Exposure — significantly underexposed (too dark) or overexposed (washed out)?
3. Subject framing — is the main item centered and fully visible (not cut off)?
4. Multiple items in frame — are there multiple distinct items that should be separate listings?

A photo passes if it is sharp, properly exposed, the subject is fully visible, and there is only one main item.`,
      jsonSchema: {
        type: 'object' as const,
        properties: {
          passed: {
            type: 'boolean',
            description: 'True if photo is suitable for listing',
          },
          issues: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of specific quality issues found',
          },
          verdict: {
            type: 'string',
            description: 'One-sentence summary of the quality assessment',
          },
        },
        required: ['passed', 'issues', 'verdict'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('photo-quality-gate: Claude did not return a tool_use block')
    }
    throw err
  }
}

export const photoQualityGate = inngest.createFunction(
  {
    id: 'photo-quality-gate',
    name: 'Photo Quality Gate',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl } = (
      event as unknown as StudioUploadedEvent
    ).data

    const quality = await step.run('check-quality', () => checkPhotoQuality(photoUrl))

    const supabase = getSupabaseAdmin()

    if (!quality.passed) {
      await supabase
        .from('photos')
        .update({
          photoroom_meta: {
            quality_failed: true,
            quality_issues: quality.issues,
            quality_verdict: quality.verdict,
          },
        })
        .eq('id', photoId)

      return { ok: false, listingId, photoId, issues: quality.issues }
    }

    // Independent of skip_background_removal below -- inclusion detection should run whether
    // or not background removal itself is skipped. Self-contained (own select, own apiKeys
    // fetch) rather than threading state from the later branch, matching how Inngest steps in
    // this codebase are already independent (e.g. intake-pipeline.ts's store-gender step
    // re-reads what it needs rather than relying on an earlier step's return value). Best-effort:
    // a failure here must not block background removal below.
    try {
      await step.run('detect-inclusions', async () => {
        const { data: incRow } = await supabase
          .from('listings')
          .select('user_id, category, sub_type, inclusions')
          .eq('id', listingId)
          .single()
        if (!incRow) return

        const apiKeys = await getUserApiKeys(incRow.user_id)
        const checklist = getInclusionChecklist(incRow.category ?? '', incRow.sub_type)
        const detected = await detectInclusionsFromPhoto(photoUrl, checklist, apiKeys)
        const merged = mergeDetectedInclusions((incRow.inclusions as Inclusion[]) ?? [], detected)
        await supabase.from('listings').update({ inclusions: merged }).eq('id', listingId)
      })
    } catch (err) {
      console.error(`detect-inclusions failed for listing ${listingId}, photo ${photoId}:`, err)
    }

    const { data: listingRow } = await supabase
      .from('listings')
      .select('user_id, skip_background_removal')
      .eq('id', listingId)
      .single()

    if (listingRow?.skip_background_removal) {
      return { ok: true, listingId, photoId, skipped: true }
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .select('raw_url')
      .eq('id', photoId)
      .single()

    if (!photoRow?.raw_url) {
      throw new Error(`photo-quality-gate: photo ${photoId} has no raw_url`)
    }

    const apiKeys = await getUserApiKeys(listingRow?.user_id ?? null)
    const storagePath = `studio/${listingId}/processed-${photoId}.png`
    await removeBackground(photoId, photoRow.raw_url as string, storagePath, apiKeys)

    return { ok: true, listingId, photoId }
  }
)
