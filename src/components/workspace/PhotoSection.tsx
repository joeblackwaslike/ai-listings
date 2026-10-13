'use client'

import { useRef, useState, useTransition, type DragEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ImageOff } from 'lucide-react'
import { PhotoPanel, type PendingUpload } from './PhotoPanel'
import { uploadStudioPhotos } from '@/lib/photos/upload-studio-photos'
import { dragHasFiles, imageFiles, nextDisplayOrder, splitPhotos } from '@/lib/photos/photo-column'
import type { Photo } from '@/types/listings'

interface PhotoSectionProps {
  readonly photos: Photo[]
  readonly listingId: string
  readonly initialSkip: boolean
  /** Rendered under the Skip BG toggle (the price card). */
  readonly children?: ReactNode
}

/** The workspace photo column: photos and grid, direct upload by picker or drop, Skip BG toggle, then children. */
export function PhotoSection({ photos, listingId, initialSkip, children }: PhotoSectionProps) {
  const [skip, setSkip] = useState(initialSkip)
  const [busy, setBusy] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)
  const nextKey = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  async function toggle() {
    setBusy(true)
    const next = !skip
    setSkip(next)
    try {
      const res = await fetch(`/api/listings/${listingId}/skip-bg`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip: next }),
      })
      if (!res.ok) throw new Error(`skip-bg update failed (${res.status})`)
    } catch {
      setSkip(!next)
    } finally {
      setBusy(false)
    }
  }

  async function upload(files: File[]) {
    const images = imageFiles(files)
    if (images.length === 0) {
      if (files.length > 0) toast.error('Only image files are accepted')
      return
    }
    const batch = images.map((f) => ({ key: `u${nextKey.current++}`, name: f.name }))
    setPendingUploads((prev) => [...prev, ...batch])
    const dropTile = (key: string) => setPendingUploads((prev) => prev.filter((u) => u.key !== key))
    try {
      // Each finished file swaps its spinner tile for the real thumbnail in one transition, so
      // the tile disappears only when the refreshed photo list arrives.
      await uploadStudioPhotos(listingId, images, nextDisplayOrder(splitPhotos(photos).gridPhotos), {
        onProgress: (done) => startTransition(() => {
          dropTile(batch[done - 1].key)
          router.refresh()
        }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
      startTransition(() => {
        setPendingUploads((prev) => prev.filter((u) => !batch.some((b) => b.key === u.key)))
        router.refresh()
      })
    }
  }

  function onDragEnter(e: DragEvent) {
    if (!dragHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    dragDepth.current++
    setDropActive(true)
  }

  function onDragOver(e: DragEvent) {
    if (dragHasFiles(e.dataTransfer.types)) e.preventDefault()
  }

  function onDragLeave(e: DragEvent) {
    if (!dragHasFiles(e.dataTransfer.types)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  function onDrop(e: DragEvent) {
    if (!dragHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    dragDepth.current = 0
    setDropActive(false)
    void upload(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className="relative min-h-full space-y-3"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive && (
        <div className="absolute -inset-3 z-30 rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-950/70 flex flex-col items-center justify-center text-emerald-300 pointer-events-none"
      >
          <span className="text-2xl">⤓</span>
          <span className="text-sm font-medium mt-1">Drop to upload studio photos</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void upload(files)
        }}
      />
      <PhotoPanel photos={photos} pendingUploads={pendingUploads} onAddPhotos={() => fileInputRef.current?.click()} />
      <button
        onClick={toggle}
        disabled={busy}
        title={skip ? 'Background removal skipped — click to re-enable' : 'Skip background removal'}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
          skip
            ? 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
            : 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'
        }`}
      >
        <ImageOff className="w-3 h-3" />
        {skip ? 'BG removal off' : 'Skip BG removal'}
      </button>
      {children}
    </div>
  )
}
