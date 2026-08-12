import Anthropic from '@anthropic-ai/sdk'
import type { ClaudeImageInput, StructuredCallParams, TextCallParams } from './types'
import { ClaudeStructuredOutputError } from './types'

const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TOOL_NAME = 'return_structured_output'
const DEFAULT_TOOL_DESCRIPTION = 'Return the structured output matching the provided JSON schema.'

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

function buildUserContent(
  prompt: string,
  image: ClaudeImageInput | undefined
): string | Anthropic.Messages.ContentBlockParam[] {
  if (!image) return prompt
  // Image block first, then text — matches every pre-facade image call site
  // (step2-vision-analysis.ts, photo-quality-gate.ts).
  return [buildImageBlock(image), { type: 'text', text: prompt }]
}

/**
 * Extracted from the `new Anthropic(...)` + `client.messages.create(...)`
 * forced-tool-call pattern shared by the structured-output call sites
 * (step2, step4a, step5, photo-quality-gate, text-intake-pipeline,
 * agent/tools.ts::buildDescription). Pure refactor — same headers (via the
 * SDK client), same tool-forcing (`tools: [...]`, `tool_choice: {type:
 * 'tool', name}`), same image content-block shape.
 */
export async function runStructuredApiKey<T>(params: StructuredCallParams): Promise<T> {
  const client = new Anthropic({ apiKey: params.apiKey })

  const toolName = params.toolName ?? DEFAULT_TOOL_NAME
  const toolDescription = params.toolDescription ?? DEFAULT_TOOL_DESCRIPTION

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: params.jsonSchema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: buildUserContent(params.prompt, params.image) }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ClaudeStructuredOutputError(
      `claude/api-key-backend: model did not return a tool_use block for tool "${toolName}"`
    )
  }

  return toolUse.input as T
}

/**
 * Extracted from the plain-text `client.messages.create(...)` pattern shared
 * by step3-pricing-research.ts's three text call sites and mechmarket.ts.
 * Returns the FIRST text-type content block verbatim (not concatenated,
 * not trimmed) — matches every pre-facade text call site, which each did
 * their own `.find((b) => b.type === 'text')` and post-processing (trim,
 * JSON-fence stripping, regex extraction) on the raw string.
 */
export async function runTextApiKey(params: TextCallParams): Promise<string> {
  const client = new Anthropic({ apiKey: params.apiKey })

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: params.prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}
