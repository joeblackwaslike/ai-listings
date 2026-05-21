'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface ToastItem {
  id: string
  notifId: string
  platform: string | null
  title: string
  preview: string | null
  source_url: string | null
  related_listing_id: string | null
  type: string
  metadata: Record<string, unknown> | null
}

const MAX_TOASTS = 3

export function NotificationToast() {
  const router = useRouter()
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const supabase = createClient()
    const timerIds: ReturnType<typeof setTimeout>[] = []
    let channel: ReturnType<typeof supabase.channel> | null = null

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return

      channel = supabase
        .channel('notification-toast')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string
              type: string
              platform: string | null
              title: string
              preview: string | null
              source_url: string | null
              related_listing_id: string | null
              metadata: Record<string, unknown> | null
              read_at: string | null
            }
            if (row.read_at !== null) return

            const toast: ToastItem = {
              id: crypto.randomUUID(),
              notifId: row.id,
              platform: row.platform,
              title: row.title,
              preview: row.preview ? row.preview.slice(0, 80) : null,
              source_url: row.source_url,
              related_listing_id: row.related_listing_id,
              type: row.type,
              metadata: row.metadata,
            }

            setToasts((prev) => {
              const next = [toast, ...prev].slice(0, MAX_TOASTS)
              return next
            })

            // Auto-dismiss after 5s
            const timerId = setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== toast.id))
            }, 5000)
            timerIds.push(timerId)
          }
        )
        .subscribe()
    })

    return () => {
      timerIds.forEach(clearTimeout)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleClick(toast: ToastItem) {
    dismiss(toast.id)

    // Mark as read
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: toast.notifId }),
    })

    if (toast.source_url) {
      window.open(toast.source_url, '_blank', 'noopener')
    } else if (toast.related_listing_id) {
      router.push(`/listings/${toast.related_listing_id}`)
    }
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => void handleClick(toast)}
          className="flex w-80 cursor-pointer items-start gap-3 rounded-xl border border-gray-700 bg-gray-900 p-3 shadow-xl transition-all hover:bg-gray-800"
        >
          {toast.platform && (
            <span className="mt-0.5 shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
              {toast.platform.slice(0, 3).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-100">{toast.title}</p>
            {toast.preview && (
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-400">{toast.preview}</p>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dismiss(toast.id)
            }}
            className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
