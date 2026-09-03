'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Listing } from '@/types/listings'

interface Props {
  listing: Listing
}

interface PlatformFields {
  ebay?: { title?: string; description?: string }
  poshmark?: { title?: string; description?: string }
}

function Field({ label, value, markdown }: { label: string; value: string | null | undefined; markdown?: boolean }) {
  if (!value) return null
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <div className="text-xs text-gray-300 leading-relaxed bg-gray-900/60 rounded px-2 py-1.5">
        {markdown
          ? <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:text-gray-200 prose-strong:text-gray-200" style={{ fontSize: '0.75rem' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></div>
          : <p className="whitespace-pre-wrap">{value}</p>
        }
      </div>
    </div>
  )
}

export function CopyReviewPanel({ listing }: Readonly<Props>) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteNotes, setRewriteNotes] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [rewriteRequested, setRewriteRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pf = (listing.platform_fields ?? {}) as PlatformFields

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${listing.id}/approve-copy`, { method: 'PATCH' })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to approve — please try again')
      }
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setApproving(false)
    }
  }

  async function handleRequestRewrite() {
    setRequesting(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${listing.id}/request-rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_notes: rewriteNotes }),
      })
      if (res.ok) {
        setRewriteRequested(true)
      } else {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to request rewrite — please try again')
      }
    } catch {
      setError('Network error — please check your connection and try again')
    } finally {
      setRequesting(false)
    }
  }

  if (rewriteRequested) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 text-center text-amber-300 text-sm">
        Rewrite requested — check back in about a minute.
      </div>
    )
  }

  const loading = approving || requesting

  return (
    <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-4 space-y-4">
      <p className="text-sm font-medium text-amber-200">Review copy before approving</p>

      <div className="space-y-3">
        <Field label="Title" value={listing.title} />
        <Field label="Description" value={listing.description} markdown />
        <Field label="Condition notes" value={listing.condition_notes} />
        {pf.ebay?.title && <Field label="eBay title" value={pf.ebay.title} />}
        {pf.ebay?.description && <Field label="eBay description" value={pf.ebay.description} markdown />}
        {pf.poshmark?.title && <Field label="Poshmark title" value={pf.poshmark.title} />}
        {pf.poshmark?.description && <Field label="Poshmark description" value={pf.poshmark.description} markdown />}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={loading}
          className="flex-1 py-2 text-sm font-semibold rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {approving && <Loader2 className="w-4 h-4 animate-spin" />}
          {approving ? 'Approving…' : 'Approve'}
        </button>

        <button
          type="button"
          onClick={() => setRewriteOpen((o) => !o)}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors"
        >
          Rewrite with notes
          {rewriteOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {rewriteOpen && (
        <div className="space-y-2">
          <textarea
            value={rewriteNotes}
            onChange={(e) => setRewriteNotes(e.target.value)}
            placeholder="What needs fixing? (e.g. 'remove the key-value block at the top, open with a flowing paragraph')"
            rows={3}
            disabled={loading}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors resize-y disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleRequestRewrite()}
            disabled={loading}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {requesting && <Loader2 className="w-4 h-4 animate-spin" />}
            {requesting ? 'Requesting…' : 'Submit rewrite'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
