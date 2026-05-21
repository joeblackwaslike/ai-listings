'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2 } from 'lucide-react'

export function ArchiveButton({ listingId }: Readonly<{ listingId: string }>) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleArchive() {
    if (!confirm('Archive this listing?')) return
    setLoading(true)
    try {
      const res = await fetch(`/api/listings/${listingId}/archive`, { method: 'PATCH' })
      if (res.ok) router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleArchive}
      disabled={loading}
      title="Archive listing"
      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
      Archive
    </button>
  )
}
