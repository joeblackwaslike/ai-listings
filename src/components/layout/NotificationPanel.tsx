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
  offer_id: string | null
  offer_amount: number | null
  offer_expires_at: string | null
  buyer_username: string | null
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
  const [offerState, setOfferState] = useState<{ id: string; counterMode: boolean; counterAmount: string; loading: boolean } | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = (await res.json()) as { notifications: Notification[] }
      setNotifications(json.notifications)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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

  async function handleOfferAction(n: Notification, action: 'accept' | 'decline' | 'counter') {
    if (action === 'counter' && offerState?.id === n.id && !offerState.counterMode) {
      setOfferState({ id: n.id, counterMode: true, counterAmount: '', loading: false })
      return
    }
    const counterAmount = action === 'counter' ? parseFloat(offerState?.counterAmount ?? '') : undefined
    if (action === 'counter' && (!counterAmount || isNaN(counterAmount))) return

    setOfferState((s) => s ? { ...s, loading: true } : { id: n.id, counterMode: false, counterAmount: '', loading: true })
    await fetch(`/api/notifications/${n.id}/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, counterAmount }),
    })
    setNotifications((prev) =>
      prev.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)
    )
    if (!n.read_at) onCountChange(-1)
    setOfferState(null)
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
                    {n.type === 'offer_received' && n.offer_id && (
                      <div
                        className="mt-2 flex flex-col gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {offerState?.id === n.id && offerState.counterMode ? (
                          <div className="flex gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Counter $"
                              value={offerState.counterAmount}
                              onChange={(e) => setOfferState((s) => s ? { ...s, counterAmount: e.target.value } : s)}
                              className="w-24 rounded bg-gray-700 px-2 py-1 text-xs text-gray-100 outline-none ring-1 ring-gray-600 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => void handleOfferAction(n, 'counter')}
                              disabled={offerState.loading}
                              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                            >
                              Send
                            </button>
                            <button
                              onClick={() => setOfferState(null)}
                              className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <button
                              onClick={() => void handleOfferAction(n, 'accept')}
                              disabled={offerState?.loading && offerState.id === n.id}
                              className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-40"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => void handleOfferAction(n, 'decline')}
                              disabled={offerState?.loading && offerState.id === n.id}
                              className="rounded bg-red-800 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
                            >
                              Decline
                            </button>
                            <button
                              onClick={() => void handleOfferAction(n, 'counter')}
                              disabled={offerState?.loading && offerState.id === n.id}
                              className="rounded bg-gray-700 px-2 py-1 text-xs font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-40"
                            >
                              Counter
                            </button>
                          </div>
                        )}
                      </div>
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
