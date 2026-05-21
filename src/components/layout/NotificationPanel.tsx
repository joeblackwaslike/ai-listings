'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { MessageThreadPanel } from '@/components/messaging/MessageThreadPanel'

export interface Notification {
  id: string
  user_id: string
  type: string
  platform: string | null
  title: string
  preview: string | null
  source_url: string | null
  related_listing_id: string | null
  metadata: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

interface NotificationPanelProps {
  onClose: () => void
  onCountChange: (delta: number) => void
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

function platformLabel(platform: string | null): string {
  if (!platform) return ''
  return platform.charAt(0).toUpperCase() + platform.slice(1).replace(/_/g, ' ')
}

export function NotificationPanel({ onClose, onCountChange }: NotificationPanelProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [thread, setThread] = useState<{ platform: string; threadId: string } | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = (await res.json()) as { notifications: Notification[] }
      setNotifications(json.notifications)
    } finally {
      setLoading(false)
    }
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return

    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })

    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    )
    onCountChange(-unreadIds.length)
  }

  async function handleClick(n: Notification) {
    // Mark as read
    if (!n.read_at) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      })
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      )
      onCountChange(-1)
    }

    // Open message thread for messaging types
    if (n.type === 'reddit_message' || n.type === 'listing_question') {
      const meta = n.metadata ?? {}
      const threadId = (meta.thread_id as string | undefined) ?? ''
      if (threadId && n.platform) {
        setThread({ platform: n.platform, threadId })
        return
      }
    }

    // Navigate to source
    if (n.source_url) {
      window.open(n.source_url, '_blank', 'noopener')
    } else if (n.related_listing_id) {
      router.push(`/listings/${n.related_listing_id}`)
      onClose()
    }
  }

  if (thread) {
    return (
      <MessageThreadPanel
        platform={thread.platform}
        threadId={thread.threadId}
        onClose={() => setThread(null)}
      />
    )
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div className="absolute right-0 top-8 z-50 w-96 rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="text-sm font-semibold text-gray-100">Notifications</span>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[480px] overflow-y-auto">
        {loading ? (
          <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-500">No notifications</div>
        ) : (
          <ul>
            {notifications.map((n) => {
              const isUnread = !n.read_at
              return (
                <li
                  key={n.id}
                  onClick={() => void handleClick(n)}
                  className={[
                    'flex cursor-pointer gap-3 border-b border-gray-800/60 px-4 py-3 transition-colors last:border-0',
                    isUnread
                      ? 'border-l-2 border-l-blue-500 bg-blue-950/20 hover:bg-blue-950/30'
                      : 'hover:bg-gray-800/40',
                  ].join(' ')}
                >
                  {/* Platform badge */}
                  {n.platform && (
                    <span className="mt-0.5 shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
                      {platformLabel(n.platform).slice(0, 3)}
                    </span>
                  )}

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <p
                        className={[
                          'truncate text-sm',
                          isUnread ? 'font-semibold text-gray-100' : 'font-normal text-gray-300',
                        ].join(' ')}
                      >
                        {n.title}
                      </p>
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    {n.preview && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">{n.preview}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
