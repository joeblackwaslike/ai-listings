/**
 * Shared types for the Claude call facade (`src/lib/claude`).
 *
 * The facade exists so every Anthropic call site in the pipeline goes through
 * one abstraction that can dispatch to either the pay-per-token API-key
 * backend or the Claude subscription (OAuth) backend without callers caring
 * which one is active.
 */

export type ClaudeImageInput = { url: string } | { base64: string; mediaType: string }

export interface StructuredCallParams {
  model: string
  prompt: string
  /** JSON-schema-shaped object describing the desired structured output. */
  jsonSchema: Record<string, unknown>
  image?: ClaudeImageInput
  /**
   * Per-user/per-request API key. Ignored by the oauth backend. When
   * omitted, the api-key backend falls back to `process.env.ANTHROPIC_API_KEY`
   * (the underlying `@anthropic-ai/sdk` client's own default), matching the
   * pre-facade call sites that did the same via `new Anthropic({ apiKey })`.
   */
  apiKey?: string
  maxTokens?: number
  /**
   * Name of the forced tool used to elicit structured output from the
   * api-key backend. Each pre-facade call site used its own tool name
   * (e.g. `extract_product_info`, `generate_listing`) — preserved here
   * instead of a shared generic name so migration is a pure refactor.
   */
  toolName?: string
  /** Description of the forced tool. See `toolName`. */
  toolDescription?: string
}

export interface StructuredCallResult<T> {
  data: T
}

export interface TextCallParams {
  model: string
  prompt: string
  apiKey?: string
  maxTokens?: number
}

export interface TextCallResult {
  text: string
}

/**
 * Thrown by a backend when a structured call could not produce a result
 * matching the requested schema (e.g. the model never called the forced
 * tool, or the Agent SDK query never emitted a `structured_output`).
 *
 * Callers that need to preserve a pre-facade error message (some are
 * pattern-matched downstream, e.g. `text-intake-pipeline.ts`'s
 * `onFailure` handler parses a leading `stepN:` prefix) should catch this
 * and rethrow/return their own site-specific message.
 */
export class ClaudeStructuredOutputError extends Error {
  constructor(message = 'Claude did not return a structured result') {
    super(message)
    this.name = 'ClaudeStructuredOutputError'
  }
}
