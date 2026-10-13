'use client'

import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { STORAGE_KEYS, clampWidth, countUnread, lastSeenKey, latestTimestamp, readStoredNumber } from '@/lib/workspace-layout'

const PHOTO_DEFAULT = 600
const PHOTO_MIN = 320
const PHOTO_MAX_FRACTION = 0.6
const FIELDS_MIN = 320
const CHAT_DEFAULT = 380
const CHAT_MIN = 320
const CHAT_MAX_FRACTION = 0.55
const KEY_STEP = 10

/**
 * Lets the chat slot report assistant messages it adds client-side (a finished stream, a canned
 * reply) without the server page wiring a callback through the slot.
 */
export const AssistantMessageContext = createContext<((id: string) => void) | undefined>(undefined)

interface WorkspaceShellProps {
  readonly listingId: string
  /** `created_at` of each persisted assistant message, oldest first. Refreshed by polling. */
  readonly assistantMessageTimes: string[]
  readonly photos: ReactNode
  readonly fields: ReactNode
  readonly chat: ReactNode
}

function store(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

function readStoredString(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function Divider({ label, value, min, max, onDragStart, onDrag, onReset, className = '' }: Readonly<{
  label: string
  value: number
  min: number
  max: number
  onDragStart: () => void
  /** `dx` is the divider's movement in px from where the drag started. */
  onDrag: (dx: number, commit: boolean) => void
  onReset: () => void
  className?: string
}>) {
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const startX = e.clientX
    let dx = 0
    el.setPointerCapture(e.pointerId)
    onDragStart()
    document.body.classList.add('ws-dragging')
    const listeners = new AbortController()
    const end = () => {
      listeners.abort()
      document.body.classList.remove('ws-dragging')
      onDrag(dx, true)
    }
    el.addEventListener('pointermove', (ev: PointerEvent) => { dx = ev.clientX - startX; onDrag(dx, false) }, { signal: listeners.signal })
    el.addEventListener('pointerup', end, { signal: listeners.signal })
    el.addEventListener('pointercancel', end, { signal: listeners.signal })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key]
    if (step === undefined) return
    e.preventDefault()
    onDragStart()
    onDrag(step, true)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={clampWidth(value, min, 1, Math.max(min, max))}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
      className={`relative hidden lg:block cursor-col-resize group touch-none outline-none ${className}`}
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gray-800 transition-colors group-hover:w-0.5 group-hover:bg-emerald-500 group-focus-visible:w-0.5 group-focus-visible:bg-emerald-500" />
    </div>
  )
}

/**
 * Detail-page layout: photo column, divider, fields column and a collapsible chat. At `lg` and
 * up the columns resize by drag; below it they stack with the chat always shown underneath.
 */
export function WorkspaceShell({ listingId, assistantMessageTimes, photos, fields, chat }: WorkspaceShellProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [photoW, setPhotoW] = useState(PHOTO_DEFAULT)
  const [chatW, setChatW] = useState(CHAT_DEFAULT)
  const [chatOpen, setChatOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [containerW, setContainerW] = useState(0)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const [localUnread, setLocalUnread] = useState<string[]>([])
  const dragStart = useRef(0)

  // Storage is read after mount so the server render and first client render agree.
  useEffect(() => {
    const total = gridRef.current?.clientWidth ?? window.innerWidth
    setPhotoW(clampWidth(readStoredNumber(STORAGE_KEYS.photoW, PHOTO_DEFAULT), PHOTO_MIN, PHOTO_MAX_FRACTION, total))
    setChatW(clampWidth(readStoredNumber(STORAGE_KEYS.chatW, CHAT_DEFAULT), CHAT_MIN, CHAT_MAX_FRACTION, total))
    setChatOpen(readStoredString(STORAGE_KEYS.chatOpen) === '1')
    setLastSeenAt(readStoredString(lastSeenKey(listingId)))
    setLoaded(true)
  }, [listingId])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const observer = new ResizeObserver(() => setContainerW(grid.clientWidth))
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const newestAt = assistantMessageTimes.at(-1) ?? null

  // The client clock can trail the DB's; never mark "seen" earlier than the newest row shown.
  const seenNow = useCallback(() => latestTimestamp(new Date().toISOString(), newestAt), [newestAt])

  useEffect(() => {
    if (loaded && chatOpen) store(lastSeenKey(listingId), seenNow())
  }, [loaded, chatOpen, seenNow, listingId])

  const reportAssistantMessage = useCallback((id: string) => {
    setLocalUnread((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  // A streamed reply is counted locally first, then again as a persisted row once polling picks
  // it up; taking the max keeps that one message from counting twice.
  const unread = loaded && !chatOpen
    ? Math.max(countUnread(assistantMessageTimes, lastSeenAt), localUnread.length)
    : 0

  function toggleChat(open: boolean) {
    // Either way everything so far counts as seen: opening shows it, collapsing ends a view.
    const at = seenNow()
    setLastSeenAt(at)
    store(lastSeenKey(listingId), at)
    setLocalUnread([])
    setChatOpen(open)
    store(STORAGE_KEYS.chatOpen, open ? '1' : '0')
  }

  function total() {
    return gridRef.current?.clientWidth ?? window.innerWidth
  }

  function dragPhoto(dx: number, commit: boolean) {
    const w = clampWidth(dragStart.current + dx, PHOTO_MIN, PHOTO_MAX_FRACTION, total())
    setPhotoW(w)
    if (commit) store(STORAGE_KEYS.photoW, String(w))
  }

  function dragChat(dx: number, commit: boolean) {
    const w = clampWidth(dragStart.current - dx, CHAT_MIN, CHAT_MAX_FRACTION, total())
    setChatW(w)
    if (commit) store(STORAGE_KEYS.chatW, String(w))
  }

  // minmax floors keep all three columns on screen when the stored widths add up past the window;
  // the photo and chat tracks give up space before the fields track drops below its floor.
  const photoTrack = `minmax(${PHOTO_MIN}px,${photoW}px) 6px minmax(${FIELDS_MIN}px,1fr)`
  const columns = chatOpen ? `${photoTrack} 6px minmax(${CHAT_MIN}px,${chatW}px)` : `${photoTrack} 0px 44px`

  return (
    <div
      ref={gridRef}
      style={{ '--ws-cols': columns } as CSSProperties}
      className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:grid lg:grid-cols-(--ws-cols) lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      <div className="relative flex-none p-6 lg:p-5 lg:overflow-y-auto">{photos}</div>

      <Divider
        label="Resize photo column"
        value={photoW}
        min={PHOTO_MIN}
        max={Math.round(containerW * PHOTO_MAX_FRACTION)}
        onDragStart={() => { dragStart.current = photoW }}
        onDrag={dragPhoto}
        onReset={() => { setPhotoW(PHOTO_DEFAULT); store(STORAGE_KEYS.photoW, String(PHOTO_DEFAULT)) }}
      />

      <div className="flex-none px-6 pb-6 lg:p-5 lg:overflow-y-auto">{fields}</div>

      <Divider
        label="Resize chat"
        value={chatW}
        min={CHAT_MIN}
        max={Math.round(containerW * CHAT_MAX_FRACTION)}
        className={chatOpen ? '' : 'invisible overflow-hidden'}
        onDragStart={() => { dragStart.current = chatW }}
        onDrag={dragChat}
        onReset={() => { setChatW(CHAT_DEFAULT); store(STORAGE_KEYS.chatW, String(CHAT_DEFAULT)) }}
      />

      <div className="flex-none h-[80vh] border-t border-gray-800 bg-gray-950 lg:h-auto lg:border-t-0 lg:border-l lg:overflow-hidden">
        <button
          type="button"
          onClick={() => toggleChat(true)}
          aria-label={unread > 0 ? `Open agent chat, ${unread} unread` : 'Open agent chat'}
          className={`relative w-full h-full flex-col items-center pt-4 gap-3 text-gray-500 hover:text-emerald-400 hover:bg-gray-900/50 hidden ${chatOpen ? '' : 'lg:flex'}`}
        >
          {unread > 0 && (
            <span
              key={unread}
              className="ws-unread absolute top-2 right-1.5 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-gray-950 text-[10px] font-bold leading-4 text-center"
            >
              {unread}
            </span>
          )}
          <MessageSquare className="w-[18px] h-[18px]" />
          <span className="text-[10px] uppercase tracking-wider [writing-mode:vertical-rl]">Agent chat</span>
        </button>

        <div className={`h-full flex-col ${chatOpen ? 'flex' : 'flex lg:hidden'}`}>
          <div className="flex-none hidden lg:flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Agent</span>
            <button
              type="button"
              onClick={() => toggleChat(false)}
              title="Collapse"
              aria-label="Collapse agent chat"
              className="text-gray-500 hover:text-gray-200"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <AssistantMessageContext.Provider value={reportAssistantMessage}>
              {chat}
            </AssistantMessageContext.Provider>
          </div>
        </div>
      </div>
    </div>
  )
}
