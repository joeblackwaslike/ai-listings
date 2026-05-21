'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Message {
  id: string
  platform: string
  thread_id: string
  message_id: string
  direction: 'inbound' | 'outbound'
  from_username: string | null
  body: string
  related_listing_id: string | null
  sent_at: string
  read_at: string | null
  metadata: Record<string, unknown> | null
}

interface MessageThreadPanelProps {
  platform: string
  threadId: string
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MessageThreadPanel({ platform, threadId, onClose }: MessageThreadPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [replyText, setReplyText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void load()
  }, [platform, threadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function load() {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('platform', platform)
        .eq('thread_id', threadId)
        .order('sent_at', { ascending: true })

      if (!error && data) {
        setMessages(data as Message[])
      }
    } finally {
      setLoading(false)
    }
  }

  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1).replace(/_/g, ' ')

  // Try to extract source URL from any message metadata
  const sourceUrl = messages
    .map((m) => m.metadata?.thread_url as string | undefined)
    .find(Boolean)

  return (
    <div className="absolute right-0 top-8 z-50 flex h-[520px] w-96 flex-col rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-800 px-4 py-3">
        <button
          onClick={onClose}
          className="text-gray-500 transition-colors hover:text-gray-300"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="flex-1 truncate text-sm font-semibold text-gray-100">
          Thread · {platformLabel}
        </span>
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
          {platform.slice(0, 4).toUpperCase()}
        </span>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 transition-colors hover:text-blue-400"
            title={`View on ${platformLabel}`}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-500">No messages in this thread</div>
        ) : (
          messages.map((msg) => {
            const isOutbound = msg.direction === 'outbound'
            return (
              <div
                key={msg.id}
                className={['flex flex-col gap-0.5', isOutbound ? 'items-end' : 'items-start'].join(
                  ' '
                )}
              >
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                    isOutbound
                      ? 'rounded-br-sm bg-blue-600 text-white'
                      : 'rounded-bl-sm bg-gray-800 text-gray-100',
                  ].join(' ')}
                >
                  {msg.body}
                </div>
                <span className="text-[10px] text-gray-500">
                  {msg.from_username && !isOutbound ? `${msg.from_username} · ` : ''}
                  {formatTime(msg.sent_at)}
                </span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply area */}
      <div className="shrink-0 border-t border-gray-800 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply…"
            rows={2}
            className="flex-1 resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none ring-1 ring-gray-700 transition focus:ring-blue-500"
          />
          <button
            disabled
            title="Send (not yet implemented)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white opacity-40 cursor-not-allowed"
          >
            <Send size={15} />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-600">
          Sending via {platformLabel} not yet available.
        </p>
      </div>
    </div>
  )
}
