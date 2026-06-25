import Anthropic from '@anthropic-ai/sdk'
import { inngest } from '../client'
import type { StudioUploadedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { toPublicUrl, toInternalUrl } from '@/lib/pipeline/to-public-url'
import { uploadFile } from '@/lib/storage'

interface QualityOutput {
  passed: boolean
  issues: string[]
  verdict: string
}

async function checkPhotoQuality(photoUrl: string): Promise<QualityOutput> {
  const publicUrl = await toPublicUrl(photoUrl)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    tools: [
      {
        name: 'quality_check',
        description: 'Evaluate photo quality for a resale listing',
        input_schema: {
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
      },
    ],
    tool_choice: { type: 'tool', name: 'quality_check' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: publicUrl } },
          {
            type: 'text',
            text: `Evaluate this product photo for resale listing quality.

Check for:
1. Blur or motion blur — is the subject sharp?
2. Exposure — significantly underexposed (too dark) or overexposed (washed out)?
3. Subject framing — is the main item centered and fully visible (not cut off)?
4. Multiple items in frame — are there multiple distinct items that should be separate listings?

A photo passes if it is sharp, properly exposed, the subject is fully visible, and there is only one main item.`,
          },
        ],
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('photo-quality-gate: Claude did not return a tool_use block')
  }

  return toolUse.input as QualityOutput
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

    const { data: listingRow } = await supabase
      .from('listings')
      .select('skip_background_removal')
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

    const photoResponse = await fetch(toInternalUrl(photoRow.raw_url as string))
    const photoBuffer = await photoResponse.arrayBuffer()

    const formData = new FormData()
    formData.append('file', new Blob([photoBuffer], { type: 'image/jpeg' }), 'photo.jpg')

    const prResponse = await fetch('https://api.withoutbg.com/v1.0/image-without-background', {
      method: 'POST',
      headers: { 'X-API-Key': process.env.WITHOUTBG_API_KEY! },
      body: formData,
    })

    if (!prResponse.ok) {
      throw new Error(`photo-quality-gate: withoutBG HTTP ${prResponse.status}`)
    }

    const processedBuffer = Buffer.from(await prResponse.arrayBuffer())
    const storagePath = `studio/${listingId}/processed-${photoId}.png`

    const processedUrl = await uploadFile(storagePath, processedBuffer, 'image/png')

    await supabase
      .from('photos')
      .update({ processed_url: processedUrl })
      .eq('id', photoId)

    return { ok: true, listingId, photoId }
  }
)
