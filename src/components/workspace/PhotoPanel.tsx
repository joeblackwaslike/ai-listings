'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { RotateCcw, ImageOff, Image as ImageIcon, Trash2, Plus, Loader2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { applyIdOrder, reorderUpdates, splitPhotos } from '@/lib/photos/photo-column'
import type { Photo } from '@/types/listings'

export interface PendingUpload {
  readonly key: string
  readonly name: string
}

interface PhotoPanelProps {
  readonly photos: Photo[]
  readonly pendingUploads: readonly PendingUpload[]
  readonly onAddPhotos: () => void
}

function bgRemoved(photo: Photo): boolean {
  const raw = (photo.raw_url as string | null)?.split('?')[0]
  const processed = (photo.processed_url as string | null)?.split('?')[0]
  return !!(processed && processed !== raw)
}

type PhotoUrls = { raw_url?: string; processed_url?: string | null }

interface SortableThumbnailProps {
  photo: Photo
  isSelected: boolean
  isStudio: boolean
  isBusy: boolean
  isPending: boolean
  hasBgRemoval: boolean
  urlOverride?: PhotoUrls
  onSelect: () => void
  onRotate: () => void
  onBgRemoval: () => void
  onDelete: () => void
}

function SortableThumbnail({
  photo,
  isSelected,
  isStudio,
  isBusy,
  isPending,
  hasBgRemoval,
  urlOverride,
  onSelect,
  onRotate,
  onBgRemoval,
  onDelete,
}: SortableThumbnailProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id as string,
  })

  const url = (urlOverride?.processed_url ?? urlOverride?.raw_url ?? photo.processed_url ?? photo.raw_url) as string

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative group ${isDragging ? 'z-50 opacity-80' : ''}`}
      {...attributes}
    >
      <button
        onClick={onSelect}
        {...listeners}
        className={`relative w-full aspect-square rounded-lg overflow-hidden border-2 bg-gray-900 transition-colors block cursor-grab active:cursor-grabbing ${
          isSelected ? 'border-emerald-500' : 'border-transparent opacity-60 hover:opacity-80'
        }`}
      >
        <Image src={url} alt="" fill sizes="160px" draggable={false} className="object-cover" />
      </button>
      {isStudio && (
        <div className="absolute inset-0 rounded-lg flex items-end justify-end gap-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <button
            onClick={(e) => { e.stopPropagation(); onRotate() }}
            disabled={isBusy || isPending}
            title="Rotate left"
            className="pointer-events-auto w-6 h-6 rounded bg-black/70 flex items-center justify-center text-white hover:bg-black/90 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onBgRemoval() }}
            disabled={isBusy || isPending}
            title={hasBgRemoval ? 'Revert background removal' : 'Apply background removal'}
            className="pointer-events-auto w-6 h-6 rounded bg-black/70 flex items-center justify-center text-white hover:bg-black/90 disabled:opacity-40 transition-colors"
          >
            {hasBgRemoval
              ? <ImageOff className="w-3 h-3" />
              : <ImageIcon className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            disabled={isBusy || isPending}
            title="Delete photo"
            className="pointer-events-auto w-6 h-6 rounded bg-black/70 flex items-center justify-center text-red-400 hover:bg-red-900/80 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

function PendingTile({ name }: Readonly<{ name: string }>) {
  return (
    <div className="relative aspect-square rounded-lg border-2 border-transparent overflow-hidden bg-gray-900" title={`Uploading ${name}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
      </div>
      <span className="absolute bottom-1 left-1 right-1 text-[9px] text-gray-300 truncate">{name}</span>
    </div>
  )
}

/** Main photo, sortable thumbnail grid with pending-upload tiles, and the add-photos affordance. */
export function PhotoPanel({ photos, pendingUploads, onAddPhotos }: PhotoPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [urlOverrides, setUrlOverrides] = useState<Record<string, PhotoUrls>>({})
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { displayPhotos: basePhotos, isIntakeFallback, showWideDropZone } = splitPhotos(photos)
  // Local order from a drag wins until the server's photo set changes (upload or delete);
  // otherwise new uploads would never appear after a reorder.
  const displayPhotos = applyIdOrder(basePhotos, orderedIds)

  const selectedPhoto = (selectedId ? displayPhotos.find((p) => p.id === selectedId) : undefined) ?? displayPhotos[0]
  const selectedIndex = selectedPhoto ? displayPhotos.indexOf(selectedPhoto) : -1
  const mainOverride = selectedPhoto ? urlOverrides[selectedPhoto.id as string] : undefined
  const mainUrl = mainOverride?.processed_url ?? mainOverride?.raw_url ?? selectedPhoto?.processed_url ?? selectedPhoto?.raw_url

  const photoAction = useCallback(async (photoId: string, endpoint: string, body?: object) => {
    setBusy((prev) => ({ ...prev, [photoId]: true }))
    try {
      const res = await fetch(`/api/photos/${photoId}/${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (res.ok) {
        const data = await res.json() as PhotoUrls & { ok: boolean }
        if (data.raw_url) {
          setUrlOverrides((prev) => ({ ...prev, [photoId]: { raw_url: data.raw_url, processed_url: data.processed_url } }))
        }
      } else {
        const data = await res.json().catch(() => null) as { error?: string } | null
        toast.error(data?.error ?? 'Photo action failed')
      }
    } finally {
      setBusy((prev) => ({ ...prev, [photoId]: false }))
    }
    startTransition(() => router.refresh())
  }, [router, startTransition])

  const deletePhoto = useCallback(async (photoId: string) => {
    if (!confirm('Remove this photo?')) return
    setBusy((prev) => ({ ...prev, [photoId]: true }))
    try {
      await fetch(`/api/photos/${photoId}`, { method: 'DELETE' })
      setSelectedId(null)
      setOrderedIds(null)
      router.refresh()
    } finally {
      setBusy((prev) => ({ ...prev, [photoId]: false }))
    }
  }, [router])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const updates = reorderUpdates(displayPhotos.map((p) => p.id), String(active.id), String(over.id))
    if (!updates) return
    setOrderedIds(updates.map((u) => u.id))

    // Persist async — fire and forget; revert to server state on error
    const revert = () => {
      setOrderedIds(null)
      router.refresh()
    }
    fetch('/api/photos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    }).then((res) => {
      if (!res.ok) revert()
    }).catch(revert)
  }, [displayPhotos, router])

  return (
    <div className="space-y-3">
      {selectedPhoto ? (
        <div className="relative rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
          {mainUrl && (
            <Image
              src={mainUrl as string}
              alt="Listing photo"
              draggable={false}
              width={0}
              height={0}
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="block w-full h-auto max-h-[65vh] object-contain mx-auto"
            />
          )}
          <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-gray-300 uppercase tracking-wider">
            {selectedPhoto.type}
          </span>
          <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-gray-300">
            {selectedIndex + 1} / {displayPhotos.length}
          </span>
        </div>
      ) : (
        <div className="aspect-square rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600">No photos yet</p>
        </div>
      )}
      {isIntakeFallback && (
        <p className="text-xs text-gray-600">Catalog / intake reference — not a seller photo</p>
      )}
      {(!showWideDropZone || pendingUploads.length > 0) && (
        <DndContext id="photo-grid" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={showWideDropZone ? [] : displayPhotos.map((p) => p.id as string)}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(80px,1fr))]">
              {!showWideDropZone && displayPhotos.map((photo) => (
                <SortableThumbnail
                  key={photo.id as string}
                  photo={photo}
                  isSelected={photo.id === selectedPhoto?.id}
                  isStudio={photo.type === 'studio'}
                  isBusy={busy[photo.id as string] ?? false}
                  isPending={isPending}
                  hasBgRemoval={bgRemoved(photo)}
                  urlOverride={urlOverrides[photo.id as string]}
                  onSelect={() => setSelectedId(photo.id as string)}
                  onRotate={() => void photoAction(photo.id as string, 'rotate')}
                  onBgRemoval={() => void photoAction(photo.id as string, 'bg-removal', { action: bgRemoved(photo) ? 'skip' : 'apply' })}
                  onDelete={() => void deletePhoto(photo.id as string)}
                />
              ))}
              {pendingUploads.map((u) => <PendingTile key={u.key} name={u.name} />)}
              {!showWideDropZone && (
                <button
                  type="button"
                  onClick={onAddPhotos}
                  title="Add photos — click to browse or drop files here"
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-700 hover:border-emerald-500 hover:text-emerald-400 text-gray-500 flex flex-col items-center justify-center gap-0.5 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-[10px] leading-tight">Add photos</span>
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {showWideDropZone && (
        <button
          type="button"
          onClick={onAddPhotos}
          className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-emerald-500 hover:text-emerald-400 text-gray-500 py-6 flex flex-col items-center justify-center gap-1 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="text-xs font-medium">Add studio photos</span>
          <span className="text-[10px] text-gray-600">Click to browse or drop image files here</span>
        </button>
      )}
    </div>
  )
}
