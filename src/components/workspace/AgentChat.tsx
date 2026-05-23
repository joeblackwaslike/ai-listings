'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Send, Zap, Check, X, AlertCircle, ImagePlus } from 'lucide-react'
import { SuggestedReplies } from './SuggestedReplies'
import type { Suggestion } from './SuggestedReplies'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_event'
  content: string
  images?: string[]
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
  readonly listingId: string
  readonly initialMessages: InitialConversation[]
  readonly firstMessage?: string | null
  readonly suggestions?: Suggestion[] | null
  readonly pendingIdGate?: boolean
  readonly pendingGenderGate?: boolean
}

type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

type SetMessages = React.Dispatch<React.SetStateAction<ChatMessage[]>>

interface StreamCtx { assistantId: string; assistantText: string }

function uid() { return Math.random().toString(36).slice(2) }

function autoResize(e: React.SyntheticEvent<HTMLTextAreaElement>) {
  const t = e.currentTarget
  t.style.height = 'auto'
  t.style.height = `${t.scrollHeight}px`
}

function plural(n: number, word: string) { return n === 1 ? word : `${word}s` }

function ToolEventIcon({ msg }: Readonly<{ msg: ChatMessage }>) {
  if (msg.toolName === 'error') return <AlertCircle className="w-3 h-3 text-red-500 flex-none" />
  if (msg.isToolCall) return <Zap className="w-3 h-3 text-yellow-500 flex-none animate-pulse" />
  if (msg.toolOk) return <Check className="w-3 h-3 text-emerald-500 flex-none" />
  return <X className="w-3 h-3 text-red-500 flex-none" />
}

function applyEvent(
  event: AgentEvent,
  ctx: StreamCtx,
  setMessages: SetMessages,
): StreamCtx {
  if (event.type === 'text') {
    const text = ctx.assistantText + event.content
    setMessages((prev) => {
      const exists = prev.some((m) => m.id === ctx.assistantId)
      if (exists) return prev.map((m) => m.id === ctx.assistantId ? { ...m, content: text } : m)
      return [...prev, { id: ctx.assistantId, role: 'assistant', content: text }]
    })
    return { ...ctx, assistantText: text }
  }
  if (event.type === 'tool_call') {
    const toolId = uid()
    setMessages((prev) => [...prev, { id: toolId, role: 'tool_event', content: event.name, toolName: event.name, isToolCall: true }])
    return ctx
  }
  if (event.type === 'tool_result') {
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'tool_event' && m.toolName === event.name && m.isToolCall)
      if (idx === -1) return prev
      return prev.map((m, i) => i === prev.length - 1 - idx ? { ...m, isToolCall: false, toolOk: event.ok } : m)
    })
    return { assistantId: uid(), assistantText: '' }
  }
  if (event.type === 'error') {
    setMessages((prev) => [...prev, { id: uid(), role: 'tool_event', content: event.message, toolName: 'error' }])
  }
  return ctx
}

async function readStream(body: ReadableStream<Uint8Array>, ctx: StreamCtx, setMessages: SetMessages): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let current = ctx

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.replace(/^data: /, '').trim()
      if (!line) continue
      try {
        const event = JSON.parse(line) as AgentEvent
        current = applyEvent(event, current, setMessages)
      } catch { /* skip malformed */ }
    }
  }
}

export function AgentChat({ listingId, initialMessages, firstMessage, suggestions, pendingIdGate, pendingGenderGate }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : ('assistant' as const),
      content: m.content,
    }))
  )
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [streaming, setStreaming] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const idGateResolvedRef = useRef(false)
  const genderGateResolvedRef = useRef(false)
  const [pendingGender, setPendingGender] = useState<string | null>(null)
  const [awaitingSize, setAwaitingSize] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function uploadImages(files: File[]): Promise<string[]> {
    return Promise.all(files.map(async (file) => {
      const form = new FormData()
      form.append('photo', file)
      form.append('listingId', listingId)
      const res = await fetch('/api/studio-upload', { method: 'POST', body: form })
      const data = await res.json() as { photoUrl?: string }
      return data.photoUrl ?? ''
    }))
  }

  async function doSend(text: string, imagesToUpload: File[]) {
    setSuggestionsDismissed(true)
    setStreaming(true)

    let uploadedUrls: string[] = []
    if (imagesToUpload.length > 0) {
      uploadedUrls = await uploadImages(imagesToUpload)
      setPendingImages([])
    }

    const photoCount = uploadedUrls.length
    const photoNote = photoCount > 0 ? `[Uploaded ${photoCount} ${plural(photoCount, 'photo')}]\n` : ''
    const message = (photoNote + text).trim()
    const displayContent = text || `Uploaded ${photoCount} ${plural(photoCount, 'photo')}`

    setMessages((prev) => [...prev, {
      id: uid(), role: 'user', content: displayContent,
      images: photoCount > 0 ? uploadedUrls : undefined,
    }])

    try {
      const res = await fetch(`/api/agent/${listingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await readStream(res.body, { assistantId: uid(), assistantText: '' }, setMessages)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection error'
      setMessages((prev) => [...prev, { id: uid(), role: 'tool_event', content: msg, toolName: 'error' }])
    } finally {
      setStreaming(false)
    }
  }

  async function handleSuggestionSelect(suggestion: Suggestion) {
    if (suggestion.openFilePicker) {
      fileInputRef.current?.click()
      return
    }
    if (suggestion.focusInput) {
      textareaRef.current?.focus()
      return
    }
    if (suggestion.confirmPhotos) {
      await fetch(`/api/listings/${listingId}/confirm-photos`, { method: 'PATCH' })
    }
    if (suggestion.confirmId) {
      idGateResolvedRef.current = true
      setSuggestionsDismissed(true)
      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: suggestion.message ?? suggestion.label }])
      await fetch('/api/pipeline/confirm-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, confirmed: true }),
      })
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: "Confirmed! Running pricing research now — the listing will update in a moment." }])
      return
    }
    if (suggestion.confirmGender) {
      setSuggestionsDismissed(true)
      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: suggestion.message ?? suggestion.label }])
      if (suggestion.needsSize) {
        // Collect size first before firing the event
        setPendingGender(suggestion.confirmGender)
        setAwaitingSize(true)
        const sizePrompt = suggestion.confirmGender === 'mens' ? "Got it — Men's. What's the size?" : "Got it — Women's. What's the size?"
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: sizePrompt }])
        setTimeout(() => textareaRef.current?.focus(), 50)
      } else {
        // No size needed — confirm immediately
        genderGateResolvedRef.current = true
        await fetch('/api/pipeline/confirm-gender', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, gender: suggestion.confirmGender, size: null }),
        })
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: "Got it — running pricing research now. The listing will update in a moment." }])
      }
      return
    }
    await doSend(suggestion.message ?? suggestion.label, [])
  }

  async function sendMessage() {
    const text = input.trim()
    if ((!text && pendingImages.length === 0) || streaming) return
    setInput('')
    if (awaitingSize && pendingGender && text) {
      setAwaitingSize(false)
      const g = pendingGender
      setPendingGender(null)
      genderGateResolvedRef.current = true
      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text }])
      await fetch('/api/pipeline/confirm-gender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, gender: g, size: text }),
      })
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: "Perfect — running pricing research now. The listing will update in a moment." }])
      return
    }
    if (pendingIdGate && !idGateResolvedRef.current && text) {
      idGateResolvedRef.current = true
      setSuggestionsDismissed(true)
      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text }])
      await fetch('/api/pipeline/confirm-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, confirmed: false, corrections: text }),
      })
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: "Got it — re-running the identification with your correction. The card will update shortly." }])
      return
    }
    await doSend(text, pendingImages)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    setPendingImages((prev) => [...prev, ...files])
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')
    if (hasFiles) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) setPendingImages((prev) => [...prev, ...files])
  }

  function removePendingImage(i: number) {
    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && !streaming
  const showFirstMessage = messages.length === 0 && firstMessage

  return (
    <section
      aria-label="Chat"
      className="relative flex flex-col h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-emerald-500 bg-gray-950/90 pointer-events-none">
          <p className="text-sm font-medium text-emerald-400">Drop photos here</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {showFirstMessage && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-900/50">
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{firstMessage}</p>
            </div>
          </div>
        )}
        {!showFirstMessage && messages.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-8">
            Ask the agent anything about this listing — pricing, description, authentication…
          </p>
        )}
        {messages.map((msg) => {
          if (msg.role === 'tool_event') {
            const isError = msg.toolName === 'error'
            return (
              <div key={msg.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <ToolEventIcon msg={msg} />
                <span className={isError ? 'text-red-400' : ''}>
                  {isError ? msg.content : (msg.toolName ?? msg.content).replaceAll('_', ' ')}
                </span>
              </div>
            )
          }
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] space-y-1.5">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg.images.map((url) => (
                        <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-700">
                          <Image src={url} alt="Uploaded photo" fill className="object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.content && (
                    <div className="bg-gray-800 rounded-2xl rounded-tr-sm px-3 py-2">
                      <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          }
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm px-3 py-2 bg-gray-900 border border-gray-700">
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex-none border-t border-gray-800 px-4 py-3 space-y-2">
        {!suggestionsDismissed && suggestions && suggestions.length > 0 && (
          <SuggestedReplies suggestions={suggestions} onSelect={(s) => void handleSuggestionSelect(s)} />
        )}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingImages.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative group">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-700">
                  <Image src={URL.createObjectURL(file)} alt={file.name} fill className="object-cover" />
                </div>
                <button
                  onClick={() => removePendingImage(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-900 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 bg-gray-900 rounded-xl border border-gray-800 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            className="flex-none p-1 text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Attach photos"
          >
            <ImagePlus className="w-3.5 h-3.5" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingImages.length > 0 ? 'Add a message (optional)…' : 'Ask about pricing, description, auth…'}
            rows={1}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none outline-none min-h-5 max-h-32 disabled:opacity-50"
            style={{ height: 'auto' }}
            onInput={autoResize}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!canSend}
            className="flex-none p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-700 text-center">Enter to send · Shift+Enter for newline · drag photos to attach</p>
      </div>
    </section>
  )
}
