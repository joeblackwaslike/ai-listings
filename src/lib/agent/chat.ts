import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { assembleContext } from './system-prompt'
import { TOOL_SCHEMAS, executeTool } from './tools'

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MAX_ITERATIONS = 10

export async function streamAgentResponse(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const supabase = getSupabaseAdmin()

  await supabase.from('conversations').insert({
    listing_id: listingId,
    role: 'user',
    content: userMessage,
  })

  const { systemBlocks, messages: baseMessages } = await assembleContext(listingId, userMessage)
  let messages: MessageParam[] = baseMessages as MessageParam[]

  let iterations = 0
  let finalAssistantText = ''

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemBlocks as Parameters<typeof client.messages.create>[0]['system'],
        tools: TOOL_SCHEMAS,
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
    const message = err instanceof Error ? err.message : 'Unknown error in agent loop'
    emit({ type: 'error', message })
  }
}
