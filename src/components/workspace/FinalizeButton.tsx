'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function FinalizeButton({ listingId }: Readonly<{ listingId: string }>) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleFinalize() {
    if (!confirm("Finalize this listing? This moves it to the finalizing checklist and can't be undone from here.")) return
    setLoading(true)
    try {
      const res = await fetch(`/api/listings/${listingId}/finalize`, { method: 'PATCH' })
      if (res.ok) {
        router.refresh()
      } else {
        alert('Could not finalize this listing. Please try again.')
      }
    } catch {
      alert('Network error — could not finalize this listing.')
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
