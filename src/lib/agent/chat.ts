import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { assembleContext } from './system-prompt'
import { TOOL_SCHEMAS, executeTool } from './tools'
import { getClaudeBackend } from '@/lib/claude/backend'
import { runAgentOauth } from './oauth-agent'

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

const MAX_ITERATIONS = 10

export async function streamAgentResponse(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void,
  apiKeys: ApiKeys
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const client = new Anthropic({ apiKey: apiKeys.anthropic })

  await supabase.from('conversations').insert({
    listing_id: listingId,
    role: 'user',
    content: userMessage,
  })

  const { systemBlocks, messages: baseMessages } = await assembleContext(listingId, userMessage)
  let messages: MessageParam[] = baseMessages as MessageParam[]

  let iterations = 0
  let finalAssistantText = ''

  // Force build_description on the first turn when the user is clearly asking for a
  // description rewrite. Without this, the model tends to write the description as chat
  // text (stop_reason=end_turn) instead of calling the tool, especially when prior
  // conversation history contains examples of that pattern.
  const descriptionIntent = /rewrite|update.{0,20}description|write.{0,20}description|generate.{0,20}description|new description/i.test(userMessage)

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++

      const toolChoice = (descriptionIntent && iterations === 1)
        ? { type: 'tool' as const, name: 'build_description' }
        : { type: 'auto' as const }

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemBlocks as Parameters<typeof client.messages.create>[0]['system'],
        tools: TOOL_SCHEMAS,
        tool_choice: toolChoice,
        messages,
      })

      stream.on('text', (text) => {
        finalAssistantText += text
        emit({ type: 'text', content: text })
      })

      ;(stream as unknown as { on: (event: string, cb: (e: { content_block: { type: string; name?: string } }) => void) => void }).on('content_block_start', (event) => {
        if (event.content_block.type === 'tool_use') {
          emit({ type: 'tool_call', name: event.content_block.name ?? '' })
        }
      })

      const finalMessage = await stream.finalMessage()

      console.log(`[chat] iter=${iterations} stop_reason=${finalMessage.stop_reason} tool_choice=${JSON.stringify(toolChoice)} content_types=${finalMessage.content.map(b => b.type).join(',')}`)

      if (finalMessage.stop_reason !== 'tool_use') {
        break
      }

      const toolUseBlocks = finalMessage.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      )

      if (toolUseBlocks.length === 0) break

      const toolResults: MessageParam['content'] = []

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as Record<string, unknown>
        const result = await executeTool(toolUse.name, listingId, input)
        const ok = typeof result === 'object' && result !== null && 'ok' in result
          ? (result as { ok: boolean }).ok
          : false

        emit({ type: 'tool_result', name: toolUse.name, ok })

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      messages = [
        ...messages,
        { role: 'assistant', content: finalMessage.content as MessageParam['content'] },
        { role: 'user', content: toolResults },
      ]
    }

    if (iterations >= MAX_ITERATIONS) {
      emit({ type: 'error', message: 'Agent reached iteration limit — conversation may be too complex. Try a more focused question.' })
    }

    if (finalAssistantText) {
      await supabase.from('conversations').insert({
        listing_id: listingId,
        role: 'assistant',
        content: finalAssistantText,
      })
    }

    emit({ type: 'done' })
  } catch (err) {
    console.error(`[chat] CATCH err=${err instanceof Error ? err.message : String(err)} backend=${getClaudeBackend()}`)

    const isCreditsError =
      err instanceof Anthropic.APIError &&
      err.status === 400 &&
      err.message.includes('credit balance')

    if (isCreditsError && getClaudeBackend() === 'oauth') {
      console.error(`[chat] credits exhausted — retrying via OAuth subprocess agent loop`)
      try {
        // assembleContext already fetched history for the API-key path. Re-use systemBlocks
        // but rebuild messages without the current userMessage appended (runAgentOauth
        // handles the prompt construction itself).
        const historyOnly = baseMessages.slice(0, -1) as Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: string; text?: string }> }>
        const result = await runAgentOauth(listingId, userMessage, emit, systemBlocks as Array<{ type: 'text'; text: string }>, historyOnly)
        if (result) {
          await supabase.from('conversations').insert({
            listing_id: listingId,
            role: 'assistant',
            content: result,
          })
        }
        emit({ type: 'done' })
      } catch (oauthErr) {
        console.error(`[chat] OAuth agent loop also failed:`, oauthErr instanceof Error ? oauthErr.message : oauthErr)
        emit({ type: 'error', message: 'Agent unavailable — API credits exhausted and OAuth fallback failed. Try again shortly.' })
      }
      return
    }

    if (isCreditsError) {
      emit({ type: 'error', message: 'Anthropic API credits exhausted. Add credits at console.anthropic.com/settings/billing, then try again.' })
      return
    }

    const message = err instanceof Error ? err.message : 'Unknown error in agent loop'
    emit({ type: 'error', message })
  }
}
