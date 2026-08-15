'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function FinalizeButton({ listingId }: Readonly<{ listingId: string }>) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleFinalize() {
    setLoading(true)
    try {
      const res = await fetch(`/api/listings/${listingId}/finalize`, { method: 'PATCH' })
      if (res.ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleFinalize}
      disabled={loading}
      title="Finalize listing"
      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-400 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Finalize
    </button>
  )
}
