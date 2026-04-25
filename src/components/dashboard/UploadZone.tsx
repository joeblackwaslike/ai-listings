'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'

export function UploadZone() {
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
          toast.success(`${file.name} — pipeline started`)
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
