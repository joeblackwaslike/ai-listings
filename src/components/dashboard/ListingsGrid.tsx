'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ListingCard, type ListingWithCover } from './ListingCard'
import { UploadZone } from './UploadZone'

export function ListingsGrid({ initialListings }: { initialListings: ListingWithCover[] }) {
  const [listings, setListings] = useState(initialListings)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('listings-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'listings' },
        (payload) => {
          const row = payload.new as ListingWithCover
          setListings((prev) => {
            if (prev.some((l) => l.id === row.id)) return prev
            return [row, ...prev]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listings' },
        (payload) => {
          const row = payload.new as ListingWithCover
          setListings((prev) =>
            prev.map((l) => (l.id === row.id ? { ...l, ...row } : l))
          )
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="space-y-6">
      <UploadZone />
      {listings.length === 0 ? (
        <p className="text-center text-sm text-gray-600 py-16">
          No listings yet — drop some photos above to get started
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
