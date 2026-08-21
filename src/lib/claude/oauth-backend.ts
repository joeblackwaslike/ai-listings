// Talks to the regular Messages API directly with the subscription token as Bearer auth,
// instead of going through the Claude Agent SDK's query()/subprocess path this file used to
// use. The Agent SDK spins up a real `claude` CLI subprocess per call -- its own process, its
// own Node runtime, the full Claude Code system prompt reloaded every time (~36-50k
// cache-creation tokens), extended thinking on by default -- which OOM-killed the app's
// resource-constrained pod even at concurrency:1 (ai-listings-2k0). A raw Bearer-token call
// against /v1/messages is the same request shape api-key-backend.ts already makes (forced
// tool_choice, same content-block builder), just authenticated with the subscription token
// instead of a pay-per-token key: no subprocess, no forced multi-turn, ~2-3s instead of
// 30s-2min+. Confirmed working directly: Authorization: Bearer <CLAUDE_CODE_OAUTH_TOKEN> +
// header anthropic-beta: oauth-2025-04-20 is accepted by the API (verified in a live test
// against the same token this file reads from CLAUDE_CODE_OAUTH_TOKEN).
import Anthropic from '@anthropic-ai/sdk'
import type { StructuredCallParams, TextCallParams } from './types'
import { ClaudeStructuredOutputError } from './types'
import { buildUserContent } from './content-blocks'

const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TOOL_NAME = 'return_structured_output'
const DEFAULT_TOOL_DESCRIPTION = 'Return the structured output matching the provided JSON schema.'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

function oauthClient(): Anthropic {
  return new Anthropic({
    authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    apiKey: null,
    defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER },
  })
}

export async function runStructuredOauth<T>(params: StructuredCallParams): Promise<T> {
  const client = oauthClient()

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
    messages: [{ role: 'user', content: buildUserContent(params.prompt, params.image, params.images) }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ClaudeStructuredOutputError(
      `claude/oauth-backend: model did not return a tool_use block for tool "${toolName}"`
    )
  }

  return toolUse.input as T
}

export async function runTextOauth(params: TextCallParams): Promise<string> {
  const client = oauthClient()

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: params.prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}
