'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListingCard, type ListingWithCover } from './ListingCard'
import { UploadZone } from './UploadZone'

function applyInsert(prev: ListingWithCover[], row: ListingWithCover) {
  if (prev.some((l) => l.id === row.id)) return prev
  return [row, ...prev]
}

function applyUpdate(prev: ListingWithCover[], row: ListingWithCover) {
  if (row.status === 'archived') return prev.filter((l) => l.id !== row.id)
  return prev.map((l) => (l.id === row.id ? { ...l, ...row } : l))
}

export function ListingsGrid({ initialListings }: Readonly<{ initialListings: ListingWithCover[] }>) {
  const [listings, setListings] = useState(initialListings)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('listings-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'listings' },
        (payload) => setListings((prev) => applyInsert(prev, payload.new as ListingWithCover))
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listings' },
        (payload) => setListings((prev) => applyUpdate(prev, payload.new as ListingWithCover))
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  function handleArchive(id: string) {
    setListings((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <div className="space-y-6">
      <UploadZone onUpload={(listing) => setListings((prev) => applyInsert(prev, listing))} />
      {listings.length === 0 ? (
        <p className="text-center text-sm text-gray-600 py-16">
          No listings yet — drop some photos above to get started
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} onArchive={handleArchive} />
          ))}
        </div>
      )}
    </div>
  )
}
