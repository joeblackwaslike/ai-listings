'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Zap, Check, X, AlertCircle } from 'lucide-react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_event'
  content: string
  toolName?: string
  toolOk?: boolean
  isToolCall?: boolean
}

interface InitialConversation {
  id: string
  role: string
  content: string
  created_at: string
}

interface AgentChatProps {
  listingId: string
  initialMessages: InitialConversation[]
}

type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

function uid() {
  return Math.random().toString(36).slice(2)
}

export function AgentChat({ listingId, initialMessages }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }))
  )
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    setStreaming(true)

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    let assistantId = uid()
    let assistantText = ''

    try {
      const res = await fetch(`/api/agent/${listingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, '').trim()
          if (!line) continue

          let event: AgentEvent
          try {
            event = JSON.parse(line) as AgentEvent
          } catch {
            continue
          }

          if (event.type === 'text') {
            assistantText += event.content
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === assistantId)
              if (existing) {
                return prev.map((m) =>
                  m.id === assistantId ? { ...m, content: assistantText } : m
                )
              }
              return [...prev, { id: assistantId, role: 'assistant', content: assistantText }]
            })
          } else if (event.type === 'tool_call') {
            const toolId = uid()
            setMessages((prev) => [
              ...prev,
              {
                id: toolId,
                role: 'tool_event',
                content: event.name,
                toolName: event.name,
                isToolCall: true,
              },
            ])
          } else if (event.type === 'tool_result') {
            setMessages((prev) => {
              const idx = [...prev].reverse().findIndex(
                (m) => m.role === 'tool_event' && m.toolName === event.name && m.isToolCall
              )
              if (idx === -1) return prev
              const realIdx = prev.length - 1 - idx
              return prev.map((m, i) =>
                i === realIdx ? { ...m, isToolCall: false, toolOk: event.ok } : m
              )
            })
            assistantId = uid()
            assistantText = ''
          } else if (event.type === 'error') {
            setMessages((prev) => [
              ...prev,
              { id: uid(), role: 'tool_event', content: event.message, toolName: 'error' },
            ])
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection error'
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'tool_event', content: msg, toolName: 'error' },
      ])
    } finally {
      setStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-8">
            Ask the agent anything about this listing — pricing, description, authentication…
          </p>
        )}
        {messages.map((msg) => {
          if (msg.role === 'tool_event') {
            const isError = msg.toolName === 'error'
            return (
              <div key={msg.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                {isError ? (
                  <AlertCircle className="w-3 h-3 text-red-500 flex-none" />
                ) : msg.isToolCall ? (
                  <Zap className="w-3 h-3 text-yellow-500 flex-none animate-pulse" />
                ) : msg.toolOk ? (
                  <Check className="w-3 h-3 text-emerald-500 flex-none" />
                ) : (
                  <X className="w-3 h-3 text-red-500 flex-none" />
                )}
                <span className={isError ? 'text-red-400' : ''}>
                  {isError ? msg.content : (msg.toolName ?? msg.content).replace(/_/g, ' ')}
                </span>
              </div>
            )
          }

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] bg-gray-800 rounded-2xl rounded-tr-sm px-3 py-2">
                  <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                </div>
              </div>
            )
          }

          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm px-3 py-2">
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex-none border-t border-gray-800 px-4 py-3">
        <div className="flex items-end gap-2 bg-gray-900 rounded-xl border border-gray-800 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about pricing, description, auth…"
            rows={1}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none outline-none min-h-[20px] max-h-32 disabled:opacity-50"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${t.scrollHeight}px`
            }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || streaming}
            className="flex-none p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-700 mt-1 text-center">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  )
}
