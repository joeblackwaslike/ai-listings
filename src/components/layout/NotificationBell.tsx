'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationPanel } from './NotificationPanel'

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load initial unread count
  useEffect(() => {
    const supabase = createClient()

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      void supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null)
        .then(({ count }) => {
          setUnreadCount(count ?? 0)
        })
    })
  }, [])

  // Supabase realtime subscription for new notifications (scoped to current user)
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return

      channel = supabase
        .channel('notification-bell')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as { read_at: string | null }
            if (row.read_at === null) {
              setUnreadCount((prev) => prev + 1)
            }
          }
        )
        .subscribe()
    })

    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [panelOpen])

  function handleCountChange(delta: number) {
    setUnreadCount((prev) => Math.max(0, prev + delta))
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="relative flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <NotificationPanel
          onClose={() => setPanelOpen(false)}
          onCountChange={handleCountChange}
        />
      )}
    </div>
  )
}
