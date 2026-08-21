import type Anthropic from '@anthropic-ai/sdk'
import type { ClaudeImageInput } from './types'

function buildImageBlock(image: ClaudeImageInput): Anthropic.Messages.ImageBlockParam {
  if ('url' in image) {
    return { type: 'image', source: { type: 'url', url: image.url } }
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType as Anthropic.Messages.Base64ImageSource['media_type'],
      data: image.base64,
    },
  }
}

/**
 * Shared by both backends: image blocks first, then text — matches every
 * pre-facade image call site (step2-vision-analysis.ts, photo-quality-gate.ts).
 */
export function buildUserContent(
  prompt: string,
  image: ClaudeImageInput | undefined,
  images: ClaudeImageInput[] | undefined
): string | Anthropic.Messages.ContentBlockParam[] {
  const inputs = images && images.length > 0 ? images : image ? [image] : []
  if (inputs.length === 0) return prompt
  return [...inputs.map(buildImageBlock), { type: 'text', text: prompt }]
}
