// OAuth-backed agent loop using the Claude Agent SDK's in-process MCP server.
// Used when ANTHROPIC_API_KEY credits are exhausted but CLAUDE_CODE_OAUTH_TOKEN is set.
// Each tool call runs in our Node.js process; the Claude subprocess communicates back
// via the in-process MCP server. Latency is ~30s-2min/turn (full Claude Code system-prompt
// reload per call) vs ~2-5s for the direct Messages API path.
import { z } from 'zod'
import { tool, createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from './chat'
import { executeTool, TOOL_SCHEMAS } from './tools'

// Strip API key so subprocess falls through to the OAuth subscription token.
// Same pattern as oauth-backend.ts — the Claude CLI ranks ANTHROPIC_API_KEY
// above CLAUDE_CODE_OAUTH_TOKEN, so we must remove it from the subprocess env.
function subprocessEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _a, ANTHROPIC_AUTH_TOKEN: _b, ...rest } = process.env
  return rest
}

function isOk(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result &&
    (result as { ok: boolean }).ok === true
}

function makeHandler(name: string, listingId: string, emit: (e: AgentEvent) => void) {
  return async (args: Record<string, unknown>) => {
    emit({ type: 'tool_call', name })
    const result = await executeTool(name, listingId, args)
    emit({ type: 'tool_result', name, ok: isOk(result) })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  }
}

type SystemBlock = { type: 'text'; text: string }
type MsgParam = { role: 'user' | 'assistant'; content: string | Array<{ type: string; text?: string }> }

const AGENT_LOOP_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — enough for 10 turns

export async function runAgentOauth(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void,
  systemBlocks: SystemBlock[],
  history: MsgParam[]
): Promise<string> {
  const systemText = systemBlocks.map(b => b.text).join('\n\n')

  // Build prompt: format history as Human/Assistant transcript then append current message.
  const historyLines = history.map(m => {
    const role = m.role === 'user' ? 'Human' : 'Assistant'
    const text = typeof m.content === 'string'
      ? m.content
      : (m.content as Array<{ type: string; text?: string }>)
          .filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    return `${role}: ${text}`
  })
  const prompt = historyLines.length > 0
    ? [...historyLines, `Human: ${userMessage}`].join('\n\n')
    : userMessage

  // Expose our tools as an in-process MCP server. The Claude subprocess calls back
  // into our Node process for each tool invocation.
  const desc = (i: number) => TOOL_SCHEMAS[i].description ?? TOOL_SCHEMAS[i].name

  const sdkTools = [
    tool('research_pricing', desc(0), {},
      makeHandler('research_pricing', listingId, emit)),
    tool('get_auth_checklist', desc(1), {},
      makeHandler('get_auth_checklist', listingId, emit)),
    tool('build_description', desc(2),
      { tone: z.string().optional() },
      makeHandler('build_description', listingId, emit)),
    tool('update_listing', desc(3),
      { fields: z.record(z.string(), z.unknown()) },
      makeHandler('update_listing', listingId, emit)),
    tool('get_listing_summary', desc(4), {},
      makeHandler('get_listing_summary', listingId, emit)),
    tool('get_photo_plan', desc(5), {},
      makeHandler('get_photo_plan', listingId, emit)),
  ]

  const mcpServer = createSdkMcpServer({ name: 'listingtools', tools: sdkTools })

  let finalText = ''
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), AGENT_LOOP_TIMEOUT_MS)

  try {
    for await (const message of query({
      prompt,
      options: {
        systemPrompt: systemText,
        tools: [],
        mcpServers: { listingtools: mcpServer },
        maxTurns: 10,
        model: 'claude-sonnet-4-6',
        env: subprocessEnv(),
        abortController,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            finalText += block.text
            emit({ type: 'text', content: block.text })
          }
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }

  return finalText
}
