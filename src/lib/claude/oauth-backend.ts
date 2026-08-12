// UNVERIFIED — pending spike ai-listings-j2d, confirm against installed package .d.ts before
// first real use. Joe's CLAUDE_CODE_OAUTH_TOKEN doesn't exist yet, so nothing in this file has
// ever been exercised against a live call. It is structurally complete (types check, dispatch
// wiring works) but every call shape below — the `outputFormat`/`json_schema` behavior, the
// image content-block shape, and Haiku-tier model selectability — is a best-effort reading of
// `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, not a confirmed contract. Re-check
// against the installed package's .d.ts (and a real `query()` call) before trusting output from
// this file in production.
import type { Anthropic } from '@anthropic-ai/sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeImageInput, StructuredCallParams, TextCallParams } from './types'
import { ClaudeStructuredOutputError } from './types'

function logUnverifiedWarning(fn: string): void {
  console.warn(
    `[claude/oauth-backend] TODO(ai-listings-j2d): ${fn} is UNVERIFIED against a live Agent SDK call. ` +
      'Confirm outputFormat/image/model behavior via the spike before relying on this in production.'
  )
}

async function fetchImageAsBase64(image: ClaudeImageInput): Promise<{ base64: string; mediaType: string }> {
  if ('base64' in image) return { base64: image.base64, mediaType: image.mediaType }

  const response = await fetch(image.url)
  if (!response.ok) {
    throw new Error(`claude/oauth-backend: failed to fetch image ${image.url} (HTTP ${response.status})`)
  }
  const mediaType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return { base64, mediaType }
}

/**
 * Builds the single-message streaming-input prompt the Agent SDK expects
 * when an image is involved. Per the plan, we do NOT assume an unconfirmed
 * `type: 'url'` image source is supported by the Agent SDK — fetch the
 * image server-side and inline it as base64, same as the api-key backend's
 * `url` variant would send if the Agent SDK instead accepted URLs directly.
 */
async function* buildImagePromptStream(
  prompt: string,
  image: ClaudeImageInput
): AsyncGenerator<SDKUserMessage> {
  const { base64, mediaType } = await fetchImageAsBase64(image)

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType as Anthropic.Messages.Base64ImageSource['media_type'],
        data: base64,
      },
    },
    { type: 'text', text: prompt },
  ]

  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as SDKUserMessage
}

export async function runStructuredOauth<T>(params: StructuredCallParams): Promise<T> {
  logUnverifiedWarning('runStructuredOauth')

  const prompt = params.image ? buildImagePromptStream(params.prompt, params.image) : params.prompt

  let structuredOutput: unknown

  for await (const message of query({
    prompt,
    options: {
      tools: [],
      maxTurns: 1,
      model: params.model,
      outputFormat: { type: 'json_schema', schema: params.jsonSchema },
    },
  })) {
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        structuredOutput = message.structured_output
      }
      break
    }
  }

  if (structuredOutput === undefined) {
    throw new ClaudeStructuredOutputError(
      'claude/oauth-backend: Agent SDK query did not return a structured_output result'
    )
  }

  return structuredOutput as T
}

export async function runTextOauth(params: TextCallParams): Promise<string> {
  logUnverifiedWarning('runTextOauth')

  const textChunks: string[] = []

  for await (const message of query({
    prompt: params.prompt,
    options: {
      tools: [],
      maxTurns: 1,
      model: params.model,
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          textChunks.push(block.text)
        }
      }
    }
  }

  return textChunks.join('')
}
