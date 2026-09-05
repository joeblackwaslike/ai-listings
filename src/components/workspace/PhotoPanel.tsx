'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { RotateCcw, ImageOff, Image as ImageIcon, Trash2 } from 'lucide-react'
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
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Photo } from '@/types/listings'

interface PhotoPanelProps {
  readonly photos: Photo[]
  readonly listingId: string
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
  draggable: boolean
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
  draggable,
}: SortableThumbnailProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id as string,
    disabled: !draggable,
  })

  const url = (urlOverride?.processed_url ?? urlOverride?.raw_url ?? photo.processed_url ?? photo.raw_url) as string

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex-none group ${isDragging ? 'z-50 opacity-80' : ''}`}
      {...attributes}
    >
      <button
        onClick={onSelect}
        {...(draggable ? listeners : {})}
        className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors block ${
          isSelected ? 'border-emerald-500' : 'border-transparent opacity-60 hover:opacity-80'
        } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <Image src={url} alt="" fill className="object-cover" />
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

export function PhotoPanel({ photos, listingId }: PhotoPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [urlOverrides, setUrlOverrides] = useState<Record<string, PhotoUrls>>({})
  const [orderedPhotos, setOrderedPhotos] = useState<Photo[] | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const nonIntakePhotos = [...photos]
    .filter((p) => p.type !== 'intake' || p.display_order === -1)
    .sort((a, b) => a.display_order - b.display_order)
  const intakePhotos = photos.filter((p) => p.type === 'intake' && p.display_order !== -1)
  const isIntakeFallback = nonIntakePhotos.length === 0 && intakePhotos.length > 0
  // Use local ordered state if set (after a drag), otherwise use server-sorted list
  const basePhotos = nonIntakePhotos.length > 0 ? nonIntakePhotos : intakePhotos
  const displayPhotos = orderedPhotos ?? basePhotos

  const selectedPhoto = selectedId ? displayPhotos.find((p) => p.id === selectedId) : displayPhotos[0]
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
      setOrderedPhotos(null)
      router.refresh()
    } finally {
      setBusy((prev) => ({ ...prev, [photoId]: false }))
    }
  }, [router])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setOrderedPhotos((prev) => {
      const current = prev ?? basePhotos
      const oldIndex = current.findIndex((p) => p.id === active.id)
      const newIndex = current.findIndex((p) => p.id === over.id)
      const reordered = arrayMove(current, oldIndex, newIndex).map((p, i) => ({
        ...p,
        display_order: i * 1000,
      }))

      // Persist async — fire and forget; revert to server state on error
      const updates = reordered.map(({ id, display_order }) => ({ id: id as string, display_order }))
      fetch('/api/photos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      }).then((res) => {
        if (!res.ok) {
          setOrderedPhotos(null)
          router.refresh()
        }
      }).catch(() => {
        setOrderedPhotos(null)
        router.refresh()
      })

      return reordered
    })
  }, [basePhotos, router])

  return (
    <div className="space-y-6">
      {displayPhotos.length > 0 ? (
        <div className="space-y-2">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
            {mainUrl && (
              <Image src={mainUrl as string} alt="Listing photo" fill className="object-contain" />
            )}
            {selectedPhoto && (
              <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-gray-400 capitalize">
                {selectedPhoto.type}
              </span>
            )}
          </div>
          {displayPhotos.length > 1 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={displayPhotos.map((p) => p.id as string)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {displayPhotos.map((photo) => {
                    const isStudio = photo.type === 'studio' && !isIntakeFallback
                    return (
                      <SortableThumbnail
                        key={photo.id as string}
                        photo={photo}
                        isSelected={photo.id === (selectedPhoto?.id ?? displayPhotos[0]?.id)}
                        isStudio={isStudio}
                        isBusy={busy[photo.id as string] ?? false}
                        isPending={isPending}
                        hasBgRemoval={bgRemoved(photo)}
                        urlOverride={urlOverrides[photo.id as string]}
                        onSelect={() => setSelectedId(photo.id as string)}
                        onRotate={() => void photoAction(photo.id as string, 'rotate')}
                        onBgRemoval={() => void photoAction(photo.id as string, 'bg-removal', { action: bgRemoved(photo) ? 'skip' : 'apply' })}
                        onDelete={() => void deletePhoto(photo.id as string)}
                        draggable={!isIntakeFallback}
                      />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      ) : (
        <div className="aspect-square rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600">No photos yet</p>
        </div>
      )}
      {isIntakeFallback && (
        <p className="text-xs text-gray-600 -mt-4">Catalog / intake reference — not a seller photo</p>
      )}
    </div>
  )
}
