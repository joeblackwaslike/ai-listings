'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ListingWithCover } from './ListingCard'

// Server processes each photo synchronously (rotate + white balance) on a memory-constrained
// pod; firing every dropped file at once multiplied that per-request cost enough to OOM it
// (ai-listings-0yk). Cap how many uploads are in flight together.
const MAX_CONCURRENT_UPLOADS = 3
// A stuck/crash-looping backend previously left fetch() pending forever, which combined with
// pointer-events-none on the drop zone meant reload was the only way to try again. Time out
// and surface an error instead.
const UPLOAD_TIMEOUT_MS = 30_000

async function uploadOne(file: File): Promise<{ listingId: string; photoUrl: string }> {
  const formData = new FormData()
  formData.append('photo', file)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData, signal: controller.signal })
    if (!res.ok) throw new Error('Upload failed')
    return (await res.json()) as { listingId: string; photoUrl: string }
  } finally {
    clearTimeout(timeout)
  }
}

async function runWithConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items]
  async function next(): Promise<void> {
    const item = queue.shift()
    if (item === undefined) return
    await worker(item)
    await next()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
}

export function UploadZone({ onUpload }: Readonly<{ onUpload?: (listing: ListingWithCover) => void }>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function uploadFiles(files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      toast.error('Only image files are accepted')
      return
    }

    setUploading(true)
    try {
      await runWithConcurrencyLimit(imageFiles, MAX_CONCURRENT_UPLOADS, async (file) => {
        try {
          const data = await uploadOne(file)
          toast.success(`${file.name} — pipeline started`)
          onUpload?.({
            id: data.listingId,
            sku: null,
            status: 'intake',
            title: null,
            brand: null,
            category: null,
            condition: null,
            condition_notes: null,
            intake_meta: null,
            suggested_price_cents: null,
            final_price_cents: null,
            agent_blocked: false,
            agent_blocked_reason: null,
            pipeline_step: 0,
            pipeline_total: 5,
            skip_background_removal: false,
            coverPhoto: { raw_url: data.photoUrl, processed_url: null },
          })
        } catch (err) {
          const timedOut = err instanceof Error && err.name === 'AbortError'
          toast.error(timedOut ? `${file.name} timed out — try again` : `Failed to upload ${file.name}`)
        }
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 cursor-pointer select-none transition-colors ${
        isDragging
          ? 'border-emerald-500 bg-emerald-950/30'
          : 'border-gray-800 hover:border-gray-700'
      } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        void uploadFiles(Array.from(e.dataTransfer.files))
      }}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="w-5 h-5 text-gray-500" />
      <p className="text-sm text-gray-400">
        {uploading ? 'Uploading…' : 'Drop photos here or click to browse'}
      </p>
      <p className="text-xs text-gray-600">Each photo creates one listing</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(Array.from(e.target.files))
        }}
      />
    </div>
  )
}
