'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ListingWithCover } from './ListingCard'

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
    await Promise.all(
      imageFiles.map(async (file) => {
        const formData = new FormData()
        formData.append('photo', file)
        try {
          const res = await fetch('/api/upload', { method: 'POST', body: formData })
          if (!res.ok) throw new Error('Upload failed')
          const data = await res.json() as { listingId: string; photoUrl: string }
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
            agent_blocked: false,
            agent_blocked_reason: null,
            pipeline_step: 0,
            pipeline_total: 5,
            skip_background_removal: false,
            coverPhoto: { raw_url: data.photoUrl, processed_url: null },
          })
        } catch {
          toast.error(`Failed to upload ${file.name}`)
        }
      })
    )
    setUploading(false)
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
