// Verified against a live query() call using a real CLAUDE_CODE_OAUTH_TOKEN (ai-listings-j2d,
// 2026-08-12): outputFormat/json_schema returns structured_output reliably on the `result`
// message for Haiku, Sonnet, and the default model; raw model strings ('claude-haiku-4-5',
// 'claude-sonnet-4-6') pass through unchanged, no alias mapping needed; the base64-inlined
// image content block below is parsed correctly. Two real, measured costs to know about: each
// call carries ~36-50k tokens of cache-creation overhead (the full Claude Code system prompt
// loads every time, even with tools: []) and 8.5-12s latency, vs ~1-3s for a direct Messages
// API call — expected before wiring this into the pipeline, not a bug.
import type { Anthropic } from '@anthropic-ai/sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeImageInput, StructuredCallParams, TextCallParams } from './types'
import { ClaudeStructuredOutputError } from './types'
import { withOauthConcurrencyLimit } from './oauth-concurrency'

// The Agent SDK's `env` option REPLACES the subprocess environment entirely when set — when
// omitted, the subprocess inherits process.env as-is. Claude Code's own auth precedence ranks
// ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN ABOVE the subscription OAuth token, so if this app's
// existing api-key-backend credentials are present in the deployment env (they are — the
// api-key backend needs them for its own fallback path), the spawned `claude` subprocess
// silently prefers the pay-per-token key over CLAUDE_CODE_OAUTH_TOKEN, defeating the whole
// point of this backend. Strip both so the subprocess falls through to the OAuth token.
function subprocessEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken, ...rest } = process.env
  return rest
}

// query() has no built-in timeout -- if the spawned `claude` subprocess hangs (bad/expired
// CLAUDE_CODE_OAUTH_TOKEN, network stall, subprocess never starts), the for-await loop below
// waits forever. Because every call funnels through withOauthConcurrencyLimit's single-file
// mutex, one hung call blocks every subsequent queued call behind it forever too -- a
// queue-wide deadlock that looks identical to an Inngest scheduler stall from the outside
// (step sits "Started", never completes) but has nothing to do with Inngest. Confirmed
// 2026-08-24: 8 resume-pipeline runs fired at once all wedged on the first call in the queue,
// survived two full Inngest pod restarts unchanged (steps re-entered the same hang), and the
// app logs showed no oauth-backend result or error at all after the fallback kicked in --
// just silence.
//
// First shipped at 90s based on this file's top-comment latency figure (8.5-12s) -- wrong
// reference point. That figure is from a single verification call with a trivial prompt and
// tiny schema; runText/index.ts's own top comment documents realistic call latency for this
// backend as "~30s-2min/call" (full Claude Code system-prompt reload every time, no cache
// warm-up). 90s was killing real in-flight calls before they'd have completed, which is worse
// than the deadlock it was meant to fix -- every scoreCompRelevance batch during the 2026-08-24
// incident logged OauthCallTimeoutError back-to-back instead of ever succeeding. 180s clears
// the documented 2min ceiling with margin while still bounding the queue-wide-deadlock case.
const OAUTH_CALL_TIMEOUT_MS = 180_000

class OauthCallTimeoutError extends Error {
  constructor() {
    super(`claude/oauth-backend: query() did not complete within ${OAUTH_CALL_TIMEOUT_MS}ms`)
    this.name = 'OauthCallTimeoutError'
  }
}

async function withOauthTimeout<T>(run: (abortController: AbortController) => Promise<T>): Promise<T> {
  const abortController = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort()
      reject(new OauthCallTimeoutError())
    }, OAUTH_CALL_TIMEOUT_MS)
  })

  try {
    return await Promise.race([run(abortController), timeout])
  } finally {
    clearTimeout(timer!)
  }
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
async function* buildImagesPromptStream(
  prompt: string,
  images: ClaudeImageInput[]
): AsyncGenerator<SDKUserMessage> {
  const fetched = await Promise.all(images.map(fetchImageAsBase64))

  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...fetched.map(({ base64, mediaType }) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: mediaType as Anthropic.Messages.Base64ImageSource['media_type'],
        data: base64,
      },
    })),
    { type: 'text', text: prompt },
  ]

  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as SDKUserMessage
}

export async function runStructuredOauth<T>(params: StructuredCallParams): Promise<T> {
  return withOauthConcurrencyLimit(() =>
    withOauthTimeout(async (abortController) => {
      const images = params.images && params.images.length > 0 ? params.images : params.image ? [params.image] : []
      const prompt = images.length > 0 ? buildImagesPromptStream(params.prompt, images) : params.prompt

      let structuredOutput: unknown

      for await (const message of query({
        prompt,
        options: {
          tools: [],
          // maxTurns:1 shipped as an unverified placeholder (see this file's top comment) and was
          // never exercised against a real image + our actual nested schema (inclusions/photo_plan
          // arrays). That combination needs a turn to reason + call the structured-output tool and
          // a second to return the result -- maxTurns:1 cut it off every time with error_max_turns,
          // which step2/step4a/step5/photo-quality-gate's callers then saw as "did not return a
          // tool_use block". Confirmed maxTurns:3 completes (num_turns:4 in the result) against a
          // real stuck listing's photo; tested off the resource-constrained prod pod first because
          // maxTurns:4 alone was enough to OOM it before returning (ai-listings-2k0).
          maxTurns: 3,
          model: params.model,
          outputFormat: { type: 'json_schema', schema: params.jsonSchema },
          env: subprocessEnv(),
          abortController,
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
    })
  )
}

export async function runTextOauth(params: TextCallParams): Promise<string> {
  return withOauthConcurrencyLimit(() =>
    withOauthTimeout(async (abortController) => {
      const textChunks: string[] = []

      for await (const message of query({
        prompt: params.prompt,
        options: {
          tools: [],
          maxTurns: 1,
          model: params.model,
          env: subprocessEnv(),
          abortController,
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
    })
  )
}
